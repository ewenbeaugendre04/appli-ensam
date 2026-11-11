"use strict";
// Appli ENSAM — organisation : agenda Lise, partiels, tâches, matières.
// Les données vivent dans le dépôt GitHub privé, lues/écrites avec le code d'accès de l'utilisateur.

const OWNER = "ewenbeaugendre04";
const DATA_REPO = `${OWNER}/appli-ensam-data`;
const APP_REPO = `${OWNER}/appli-ensam`;
const TZ = "Europe/Paris";

// ---------- Stockage local (protégé : peut échouer) ----------
const store = {
	get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
	set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
	del(k) { try { localStorage.removeItem(k); } catch {} },
};

const S = {
	token: store.get("ae.token"),
	data: store.get("ae.cache", { config: {}, tasks: [], partiels: [], events: { events: [] } }),
	sha: {},
	vue: "accueil",
	semaine: 0,
	segTaches: "taches",
	voirFaites: false,
	horsLigne: false,
};

// ---------- Outils ----------
const $ = (s) => document.querySelector(s);
const h = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmt = (d, o) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, ...o }).format(new Date(d));
const heure = (d) => fmt(d, { hour: "2-digit", minute: "2-digit" });
const jourCle = (d) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const auj = () => jourCle(new Date());
function joursEntre(cleA, cleB) {
	const a = Date.UTC(...cleA.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
	const b = Date.UTC(...cleB.split("-").map((n, i) => (i === 1 ? n - 1 : +n)));
	return Math.round((b - a) / 86400e3);
}
function ajouterJours(cle, n) {
	const [y, m, d] = cle.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function libelleJour(cle) {
	const n = joursEntre(auj(), cle);
	if (n === 0) return "Aujourd'hui";
	if (n === 1) return "Demain";
	if (n === -1) return "Hier";
	return fmt(cle + "T12:00:00Z", { weekday: "long", day: "numeric", month: "long" });
}
// Date de Paris "AAAA-MM-JJ" + "HH:MM" → ISO UTC
function parisIso(cle, hm) {
	const [y, mo, d] = cle.split("-").map(Number);
	const [H, M] = hm.split(":").map(Number);
	const guess = Date.UTC(y, mo - 1, d, H, M);
	const off = (t) => {
		const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
		return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
	};
	return new Date(guess - off(guess - off(guess))).toISOString();
}

// ---------- API GitHub ----------
async function api(url, opts = {}) {
	const res = await fetch(`https://api.github.com/${url}`, {
		...opts,
		cache: "no-store",
		headers: { Authorization: `Bearer ${S.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
	});
	return res;
}
const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function lire(path, defaut) {
	const res = await api(`repos/${DATA_REPO}/contents/${path}`);
	if (res.status === 404) { S.sha[path] = undefined; return defaut; }
	if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Code d'accès refusé"), { auth: true });
	if (!res.ok) throw new Error(`Lecture impossible (${res.status})`);
	const j = await res.json();
	S.sha[path] = j.sha;
	return JSON.parse(b64d(j.content));
}
async function ecrire(path, data, message) {
	const body = { message, content: b64e(JSON.stringify(data, null, 2) + "\n") };
	if (S.sha[path]) body.sha = S.sha[path];
	const res = await api(`repos/${DATA_REPO}/contents/${path}`, { method: "PUT", body: JSON.stringify(body) });
	if (res.status === 409 || res.status === 422) return false; // conflit : relire puis réessayer
	if (!res.ok) throw new Error(`Enregistrement impossible (${res.status})`);
	S.sha[path] = (await res.json()).content.sha;
	return true;
}
// Modifie un fichier JSON de façon sûre même si l'autre appareil l'a changé entre-temps
async function modifier(path, cle, fn, message, opts = {}) {
	const defaut = opts.defaut ?? (cle === "config" ? {} : []);
	for (let essai = 0; essai < 3; essai++) {
		const actuel = await lire(path, defaut);
		const nouveau = fn(structuredClone(actuel));
		if (await ecrire(path, nouveau, message)) {
			if (opts.cible) S.data[opts.cible][cle] = nouveau; else S.data[cle] = nouveau;
			sauverCache();
			if (!opts.sansSynchro) relancerSynchro();
			return;
		}
	}
	throw new Error("Conflit d'enregistrement, réessaie.");
}
let synchroTimer;
function relancerSynchro() {
	// Regénère le calendrier abonné ~1 min plus tard (regroupe plusieurs modifications)
	clearTimeout(synchroTimer);
	synchroTimer = setTimeout(() => {
		api(`repos/${APP_REPO}/actions/workflows/sync.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) }).catch(() => {});
	}, 20000);
}
const sauverCache = () => store.set("ae.cache", S.data);

async function charger() {
	if (!S.token) return;
	try {
		const [config, tasks, partiels, events, notes] = await Promise.all([
			lire("config.json", {}), lire("tasks.json", []), lire("partiels.json", []), lire("events.json", { events: [] }), lire("notes.json", null).catch(() => null),
		]);
		S.data = { ...S.data, config, tasks, partiels, events, notes };
		S.horsLigne = false;
		await chargerRevision().catch(() => {});
		sauverCache();
	} catch (err) {
		if (err.auth) { bandeau("Code d'accès refusé ou expiré : mets-le à jour dans Réglages."); }
		else { S.horsLigne = true; bandeau("Hors ligne : affichage de la dernière version enregistrée."); }
		return;
	}
	bandeau(null);
	// Ne pas effacer une réponse en cours de saisie pendant une révision
	if (S.vue === "reviser" && (R.session || R.ouvert)) return;
	rendre();
}

function bandeau(texte) {
	const b = $("#bandeau");
	if (!texte) { b.hidden = true; return; }
	b.textContent = texte; b.hidden = false;
}
async function action(fn) {
	try { await fn(); rendre(); }
	catch (err) { alerteDouce(err.message || String(err)); }
}
function alerteDouce(msg) { bandeau(msg); setTimeout(() => bandeau(null), 5000); }

// ---------- Matières ----------
const ues = () => S.data.config.ues || [];
function matiereDe(ev) {
	const map = S.data.config.modules || {};
	if (ev.module && map[ev.module]) return map[ev.module];
	const txt = `${ev.module} ${ev.titre} ${ev.code || ""}`.toUpperCase();
	for (const ue of ues()) {
		for (const m of ue.matieres || []) if (m.motsCles?.some((k) => txt.includes(k.toUpperCase()))) return `${ue.code} / ${m.nom}`;
		if (txt.includes(ue.code.toUpperCase())) return ue.code;
	}
	return "";
}
function listeMatieres() {
	const out = [];
	for (const ue of ues()) { out.push(ue.code); for (const m of ue.matieres || []) out.push(`${ue.code} / ${m.nom}`); }
	return out;
}
const appartient = (lib, cible) => lib === cible || lib.startsWith(cible + " / ");

// ---------- Données dérivées ----------
const cours = () => S.data.events.events || [];
function partielsTous() {
	const surcharges = (S.data.partiels || []).filter((p) => p.liseUid);
	const lise = cours().filter((e) => e.examen).map((e) => {
		const ov = surcharges.find((p) => p.liseUid === e.uid) || {};
		return { id: "lise-" + e.uid, liseUid: e.uid, titre: ov.titre || e.titre, debut: e.debut, fin: e.fin, salle: e.salle, matiere: ov.matiere || matiereDe(e), type: e.type, description: ov.description || "", chapitres: ov.chapitres || null, surchargeId: ov.id || "", source: "Lise" };
	});
	const perso = (S.data.partiels || []).filter((p) => !p.liseUid && p.date).map((p) => ({ ...p, debut: p.heureDebut ? parisIso(p.date, p.heureDebut) : p.date + "T00:00:00", source: "perso" }));
	return [...lise, ...perso].sort((a, b) => a.debut.localeCompare(b.debut));
}
const echeanceCle = (t) => (t.echeance ? (t.echeance.length > 10 ? jourCle(t.echeance) : t.echeance) : "9999-12-31");
const tachesOuvertes = () => (S.data.tasks || []).filter((t) => !t.fait).sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999"));

// ---------- Composants ----------
const salle = (x) => (x || "").replace(/^PA_/, "").replace(/_/g, " ");
const PALETTE = ["#8a1c2c", "#2f6f9f", "#2e7d5b", "#b7791f", "#6b4fa0", "#c2412d", "#2b8a8a", "#9a4f7a", "#5b6b2f", "#44617a"];
function couleur(lib) {
	if (!lib) return "#8a8079";
	const i = ues().findIndex((u) => u.code === lib.split(" / ")[0]);
	return i < 0 ? "#8a8079" : PALETTE[i % PALETTE.length];
}
function ligneCours(e) {
	const mat = matiereDe(e);
	return `<div class="ligne barre cliquable" style="--c:${couleur(mat)}" data-cours="${h(e.uid)}">
		<div class="heure">${e.journee ? "Journée" : `<b>${heure(e.debut)}</b><br>${heure(e.fin)}`}</div>
		<div class="corps"><div class="t">${e.examen ? `<span class="pastille examen">${h(e.type || "Examen")}</span>` : e.type ? `<span class="pastille">${h(e.type)}</span>` : ""}${h(e.titre)}</div>
		<div class="s">${[salle(e.salle), e.profs, mat].filter(Boolean).map(h).join(" · ")}</div></div></div>`;
}
function ligneTache(t) {
	const cle = echeanceCle(t);
	const n = t.echeance ? joursEntre(auj(), cle) : null;
	const quand = !t.echeance ? "Sans échéance" : (n < 0 && !t.fait ? `<span class="retard">En retard · ${h(libelleJour(cle))}</span>` : h(libelleJour(cle))) + (t.echeance.length > 10 ? " à " + heure(t.echeance) : "");
	return `<div class="ligne ${t.fait ? "fait" : ""}" style="--c:${couleur(t.matiere)}">
		<input type="checkbox" class="coche" data-cocher="${h(t.id)}" ${t.fait ? "checked" : ""} aria-label="Terminée">
		<div class="corps cliquable" data-tache="${h(t.id)}"><div class="t">${h(t.titre)}</div>
		<div class="s">${quand}${t.matiere ? " · " + h(t.matiere) : ""}</div></div></div>`;
}
function lignePartiel(p) {
	const n = joursEntre(auj(), jourCle(p.debut));
	return `<div class="ligne cliquable" data-partiel-voir="${h(p.id)}">
		<div class="compte ${n >= 0 && n <= 7 ? "proche" : ""}"><b>${n < 0 ? "✓" : n === 0 ? "Auj." : "J-" + n}</b><small>${fmt(p.debut, { day: "numeric", month: "short" })}</small></div>
		<div class="corps"><div class="t">${h(p.titre)}</div>${p.description ? `<div class="s">📋 ${h(p.description.slice(0, 70))}${p.description.length > 70 ? "…" : ""}</div>` : ""}<div class="s">${[p.debut.length > 10 && !p.debut.endsWith("T00:00:00") ? heure(p.debut) : "", salle(p.salle), p.matiere, p.type].filter(Boolean).map(h).join(" · ")}</div></div></div>`;
}
function dansCombien(iso) {
	const min = Math.round((Date.parse(iso) - Date.now()) / 60e3);
	if (min <= 0) return "En cours";
	if (min < 60) return `Dans ${min} min`;
	if (min < 24 * 60) return `Dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
	return libelleJour(jourCle(iso));
}
function hero() {
	const now = new Date().toISOString();
	const e = cours().find((x) => x.fin > now && !x.journee);
	if (!e) return `<div class="hero calme"><div class="eti">Prochain cours</div><div class="nom">Rien de prévu</div><div class="info">Profite-en pour réviser.</div></div>`;
	const mat = matiereDe(e);
	return `<div class="hero" style="--c:${couleur(mat)}" data-cours="${h(e.uid)}">
		<span class="dans">${h(dansCombien(e.debut))}</span>
		<div class="eti">${e.debut <= now ? "En ce moment" : "Prochain cours"}${e.type ? " · " + h(e.type) : ""}</div>
		<div class="nom">${h(e.titre)}</div>
		<div class="info">${heure(e.debut)} – ${heure(e.fin)}${e.salle ? " · " + h(salle(e.salle)) : ""}${e.profs ? " · " + h(e.profs) : ""}</div></div>`;
}

// ---------- Cours annulés ou déplacés ----------
// Une tâche liée à un cours garde une copie du créneau (coursLie). Si Lise ne contient plus ce cours,
// ou l'a déplacé, on le signale sans jamais supprimer la tâche.
function verifications() {
	const evs = cours();
	if (!evs.length || !S.data.events.majLe) return [];
	const premier = evs[0].debut, dernier = evs[evs.length - 1].debut;
	const limite = new Date(Date.now() - 86400e3).toISOString();
	const out = [];
	for (const t of S.data.tasks || []) {
		const l = t.coursLie;
		if (t.fait || !l || l.ignore) continue;
		const ev = evs.find((x) => x.uid === l.uid);
		if (ev) {
			if (ev.debut !== l.debut) out.push({ t, genre: "deplace", ev });
		} else if (l.debut >= premier && l.debut <= dernier && l.debut >= limite) {
			out.push({ t, genre: "annule" });
		}
	}
	return out;
}
function carteVerif(v) {
	const l = v.t.coursLie;
	const avant = `${libelleJour(jourCle(l.debut))} ${heure(l.debut)}`;
	const txt = v.genre === "deplace"
		? `Le cours <b>${h(l.titre)}</b> a été déplacé : ${h(avant)} → <b>${h(libelleJour(jourCle(v.ev.debut)))} ${heure(v.ev.debut)}</b>.`
		: `Le cours <b>${h(l.titre)}</b> du ${h(avant)} n'est plus dans Lise (annulé ou supprimé).`;
	return `<div class="ligne"><div class="corps"><div class="t">${h(v.t.titre)}</div><div class="s">${txt}</div>
		<div class="actions-ligne">
			${v.genre === "deplace" ? `<button class="bouton plein petit-b" data-suivre="${h(v.t.id)}">Suivre le nouveau créneau</button>` : ""}
			<button class="bouton petit-b ${v.genre === "annule" ? "plein" : ""}" data-reattribuer="${h(v.t.id)}">Choisir un autre cours</button>
			<button class="bouton petit-b" data-garder="${h(v.t.id)}">Garder tel quel</button>
		</div></div></div>`;
}
function feuilleReattribuer(t) {
	const now = new Date().toISOString();
	const l = t.coursLie || {};
	const memes = cours().filter((e) => e.debut > now && (e.module === t.module || (t.matiere && matiereDe(e) === t.matiere))).slice(0, 6);
	const autres = cours().filter((e) => e.debut > now && !memes.includes(e)).slice(0, 25);
	const opt = (e, i) => `<label class="choix"><input type="radio" name="ra" value="${h(e.uid)}" ${i === 0 ? "checked" : ""}><span><b>${h(libelleJour(jourCle(e.debut)))} · ${heure(e.debut)}</b><br><span class="petit">${h(e.titre)}${e.type ? " · " + h(e.type) : ""}</span></span></label>`;
	ouvrirFeuille(`<h3>Réattribuer la tâche</h3>
		<p class="petit">« ${h(t.titre)} » était liée à ${h(l.titre || "un cours")}. Choisis le nouveau cours :</p>
		<form id="f-ra">
			${memes.length ? `<div class="section-titre" style="margin-top:14px">Même matière</div>${memes.map(opt).join("")}` : ""}
			${autres.length ? `<details style="margin-top:12px"><summary class="petit">Autres cours</summary>${autres.map((e) => opt(e, memes.length ? 1 : 0)).join("")}</details>` : ""}
			<label class="case" style="display:flex;gap:8px;color:var(--texte);margin-top:16px"><input type="checkbox" id="ra-ech" checked> Mettre l'échéance à ce cours</label>
			<div class="actions"><button type="button" class="bouton" data-fermer>Annuler</button><button class="bouton plein">Réattribuer</button></div>
		</form>`);
	$("#f-ra").addEventListener("submit", (e) => {
		e.preventDefault();
		const u = new FormData(e.target).get("ra");
		const ev = cours().find((x) => x.uid === u);
		if (!ev) return;
		const ech = $("#ra-ech").checked;
		fermerFeuille();
		action(() => modifier("tasks.json", "tasks", (liste) => liste.map((x) => x.id !== t.id ? x : {
			...x, coursLie: { uid: ev.uid, debut: ev.debut, titre: ev.titre }, module: ev.module, coursUid: ev.uid,
			matiere: x.matiere || matiereDe(ev), echeance: ech ? ev.debut : x.echeance,
		}), `Réattribution : ${t.titre}`));
	});
}

// ---------- Notes ----------
// « Nouveau » = arrivée depuis ta dernière visite de la page (rien de nouveau tant que tu ne l'as jamais ouverte)
const notesNouvelles = () => { const v = store.get("ae.notesVues", ""); return v ? (S.data.notes?.notes || []).filter((x) => x.ajouteLe > v) : []; };
// UE d'une note à partir de son code Lise (ex. FITE_S7_MATA_DS1 → MATI si « MAT » correspond)
function ueDeNote(x) {
	const segs = String(x.code || "").toUpperCase().split(/[_\-\s]+/);
	for (const u of ues()) { const n = String(u.code || "").toUpperCase(); if (n && segs.some((s) => s === n || (s.length >= 3 && n.length >= 3 && s.slice(0, 3) === n.slice(0, 3)))) return u.code; }
	const lib = String(x.libelle || "").toUpperCase();
	for (const u of ues()) for (const m of u.matieres || []) if ((m.motsCles || [m.nom]).some((c) => c && lib.includes(String(c).toUpperCase()))) return u.code;
	return segs.find((s) => /^[A-Z]{3,5}$/.test(s) && !/^(FITE|GIM|DS|TP|TD|EXAM|CC)$/.test(s)) || "Autres";
}

// ---------- Vues ----------
const VUES = {
	reviser: () => vueReviser(),
	accueil() {
		const aujCle = auj();
		const verifs = verifications();
		const taches = tachesOuvertes().slice(0, 6);
		const parts = partielsTous().filter((p) => jourCle(p.debut) >= aujCle).slice(0, 4);
		const now = new Date().toISOString();
		const prochainJour = (() => {
			const heroUid = cours().find((x) => x.fin > now && !x.journee)?.uid;
			const reste = cours().filter((e) => jourCle(e.debut) === aujCle && e.fin > now && e.uid !== heroUid);
			if (reste.length > 0) return { titre: "Aujourd'hui", liste: reste };
			const suiv = cours().find((e) => jourCle(e.debut) > aujCle);
			if (!suiv) return { titre: "Aujourd'hui", liste: reste };
			const c = jourCle(suiv.debut);
			return { titre: libelleJour(c), liste: [...reste, ...cours().filter((e) => jourCle(e.debut) === c)], mixte: reste.length > 0 };
		})();
		const ev = S.data.events;
		const nNouv = notesNouvelles().length;
		return `<div class="accueil-haut"><p class="date-jour">${h(fmt(new Date(), { weekday: "long", day: "numeric", month: "long" }))}</p>
		<a href="#notes" class="pastille-notes" aria-label="Mes notes${nNouv ? ` (${nNouv} nouvelles)` : ""}"><svg viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 10-5z"/><path d="M6 10.5v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 8v6"/></svg>Notes${nNouv ? `<b>${nNouv}</b>` : ""}</a></div>
		<div class="grille deux">
			<div class="grille">
				${hero()}
				${verifs.length ? `<section class="carte verif"><h2>À vérifier</h2>${verifs.map(carteVerif).join("")}</section>` : ""}
				<section class="carte"><h2>${prochainJour.mixte ? "Ensuite" : h(prochainJour.titre)}</h2>${prochainJour.liste.length ? prochainJour.liste.map(ligneCours).join("") : '<p class="vide">Aucun cours à venir.</p>'}</section>
			</div>
			<div class="grille">
				<section class="carte"><h2>Prochaines tâches</h2>${taches.length ? taches.map(ligneTache).join("") : '<p class="vide">Rien à faire pour l\'instant. Ajoute une tâche avec +</p>'}</section>
				<section class="carte"><h2>Prochains partiels</h2>${parts.length ? parts.map(lignePartiel).join("") : '<p class="vide">Aucun partiel prévu.</p>'}</section>
			</div>
		</div>
		<p class="petit" style="margin-top:16px;text-align:center">${ev.majLe ? `Planning Lise vérifié ${h(fmt(ev.majLe, { weekday: "short", hour: "2-digit", minute: "2-digit" }))}${ev.etat && !ev.etat.ok ? " — " + h(ev.etat.message) : ""}` : "Planning pas encore synchronisé."}</p>`;
	},

	notes() {
		const n = S.data.notes;
		const lien = `https://github.com/${APP_REPO}/settings/secrets/actions/new`;
		if (!n || !(n.notes || []).length) {
			return `<section class="carte"><h2>Tes notes Lise</h2>${n?.etat && !n.etat.ok ? `<p class="avert-txt">Dernier essai : ${h(n.etat.message)}</p>` : ""}
			<p>Les notes ne sont pas publiques comme l'emploi du temps : il faut se connecter à Lise avec ton mot de passe (comme Better Lise). La synchro horaire peut le faire pour toi si tu enregistres ton mot de passe comme <b>secret GitHub</b> : chiffré, jamais affiché, ni dans l'appli ni sur le site.</p>
			<ol class="etapes-simples"><li>Ouvre <a href="${lien}" target="_blank" rel="noopener">la page des secrets du dépôt</a> (connecté à GitHub).</li><li>Name : <code>LISE_PASSWORD</code></li><li>Secret : ton mot de passe Lise, puis <b>Add secret</b>.</li></ol>
			<p class="petit">Tes notes apparaîtront ici à la synchro suivante (moins d'une heure). Si tu changes ton mot de passe Lise, mets aussi à jour ce secret.</p></section>`;
		}
		const vues = store.get("ae.notesVues", "") || "9999";
		const groupes = new Map();
		for (const x of n.notes) { const g = ueDeNote(x); if (!groupes.has(g)) groupes.set(g, []); groupes.get(g).push(x); }
		const moy = (l) => { const v = l.map((x) => x.note).filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
		const fmtN = (v) => (v == null ? "–" : v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
		const dateTri = (d) => d.split("/").reverse().join("");
		const ligne = (x) => `<div class="note-l${x.ajouteLe > vues ? " nouvelle" : ""}"><div class="note-info"><div class="note-nom">${h(x.libelle)}${x.ajouteLe > vues ? ' <span class="badge-nouv">Nouveau</span>' : ""}</div>
			<div class="petit">${h(x.date)}${x.enseignants ? " · " + h(x.enseignants) : ""}${x.absence && x.absence !== "Non" ? " · absence : " + h(x.absence) : ""}</div>${x.commentaire ? `<div class="petit note-com">« ${h(x.commentaire)} »</div>` : ""}</div>
			<div class="note-val ${typeof x.note === "number" ? (x.note >= 10 ? "ok" : "ko") : ""}">${typeof x.note === "number" ? fmtN(x.note) : h(x.brut || "–")}</div></div>`;
		const total = moy(n.notes);
		setTimeout(() => store.set("ae.notesVues", new Date().toISOString()), 1500);
		return `<section class="carte notes-tete"><div><div class="petit">Moyenne simple de tes ${n.notes.filter((x) => typeof x.note === "number").length} notes</div><div class="notes-moy ${total >= 10 ? "ok" : "ko"}">${fmtN(total)}<span>/20</span></div></div>
			<div class="petit">Sans coefficients : indicatif.<br>${n.majLe ? "Dernier changement " + h(fmt(n.majLe, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : ""}</div></section>
		${n.etat && !n.etat.ok ? `<p class="avert-txt">Synchro des notes en échec : ${h(n.etat.message)}</p>` : ""}
		${[...groupes].sort((a, b) => a[0].localeCompare(b[0])).map(([g, l]) => `<section class="carte"><h2 style="--c:${couleur(g)}" class="note-ue"><span>${h(g)}${ues().find((u) => u.code === g) ? ` · ${h(ues().find((u) => u.code === g).nom)}` : ""}</span><span class="petit">moy. ${fmtN(moy(l))}</span></h2>
			${l.sort((a, b) => dateTri(b.date).localeCompare(dateTri(a.date))).map(ligne).join("")}</section>`).join("")}`;
	},

	agenda() {
		const debutSemaine = (() => {
			const c = auj();
			const jd = new Date(c + "T12:00:00Z").getUTCDay() || 7;
			return ajouterJours(c, 1 - jd + S.semaine * 7);
		})();
		const finSemaine = ajouterJours(debutSemaine, 6);
		const parJour = {};
		for (const e of cours()) { const c = jourCle(e.debut); if (c >= debutSemaine && c <= finSemaine) (parJour[c] ||= []).push(e); }
		const tachesJour = {};
		for (const t of tachesOuvertes()) { const c = echeanceCle(t); if (c >= debutSemaine && c <= finSemaine) (tachesJour[c] ||= []).push(t); }
		let html = `<div class="nav-semaine"><button class="bouton" data-semaine="-1">‹</button>
			<strong>${S.semaine === 0 ? "Cette semaine" : h(fmt(debutSemaine + "T12:00:00Z", { day: "numeric", month: "short" })) + " – " + h(fmt(finSemaine + "T12:00:00Z", { day: "numeric", month: "short" }))}</strong><!--${h(fmt(finSemaine + "T12:00:00Z", { day: "numeric", month: "short" }))}-->
			<span><button class="bouton" data-semaine="0">Auj.</button> <button class="bouton" data-semaine="1">›</button></span></div>`;
		let rien = true;
		const aujC = auj();
		const passes = [];
		for (let i = 0; i < 7; i++) {
			const c = ajouterJours(debutSemaine, i);
			const ev = parJour[c] || [], ts = tachesJour[c] || [];
			// Semaine en cours : aujourd'hui toujours en premier, les jours passés repliés en bas
			if (S.semaine === 0 && c < aujC) { if (ev.length || ts.length) passes.push([c, ev, ts]); continue; }
			if (c === aujC && !ev.length && !ts.length) { html += `<div class="jour-titre auj">Aujourd'hui</div><div class="carte"><p class="vide">Aucun cours aujourd'hui.</p></div>`; rien = false; continue; }
			if (!ev.length && !ts.length) continue;
			rien = false;
			html += `<div class="jour-titre ${c === aujC ? "auj" : ""}">${h(libelleJour(c))}</div><div class="carte">${ev.map(ligneCours).join("")}${ts.map(ligneTache).join("")}</div>`;
		}
		if (passes.length) html += `<details style="margin-top:22px"><summary class="petit">Jours passés de la semaine (${passes.length})</summary>${passes.map(([c, ev, ts]) => `<div class="jour-titre">${h(libelleJour(c))}</div><div class="carte">${ev.map(ligneCours).join("")}${ts.map(ligneTache).join("")}</div>`).join("")}</details>`;
		if (rien) html += '<p class="vide" style="margin-top:20px">Aucun cours cette semaine.</p>';
		return html;
	},

	taches() {
		const seg = `<div class="segments"><button data-seg="taches" class="${S.segTaches === "taches" ? "actif" : ""}">Tâches</button><button data-seg="partiels" class="${S.segTaches === "partiels" ? "actif" : ""}">Partiels</button></div>`;
		if (S.segTaches === "partiels") {
			const parts = partielsTous();
			const futurs = parts.filter((p) => jourCle(p.debut) >= auj()), passes = parts.filter((p) => jourCle(p.debut) < auj());
			return seg + `<section class="carte">${futurs.length ? futurs.map(lignePartiel).join("") : '<p class="vide">Aucun partiel à venir. Ceux marqués « Examen » dans Lise apparaissent tout seuls.</p>'}</section>
				<button class="bouton large" style="margin-top:12px" data-nouveau-partiel>Ajouter un partiel</button>
				${passes.length ? `<details style="margin-top:16px"><summary class="petit">Partiels passés (${passes.length})</summary><div class="carte" style="margin-top:8px">${passes.map(lignePartiel).join("")}</div></details>` : ""}`;
		}
		const ouvertes = tachesOuvertes();
		const faites = (S.data.tasks || []).filter((t) => t.fait).sort((a, b) => (b.faitLe || "").localeCompare(a.faitLe || ""));
		return seg + `<section class="carte">${ouvertes.length ? ouvertes.map(ligneTache).join("") : '<p class="vide">Aucune tâche en cours.</p>'}</section>
			${faites.length ? `<details style="margin-top:16px" ${S.voirFaites ? "open" : ""} data-faites><summary class="petit">Terminées (${faites.length})</summary><div class="carte" style="margin-top:8px">${faites.slice(0, 40).map(ligneTache).join("")}</div></details>` : ""}`;
	},

	matieres() {
		const now = new Date().toISOString();
		const nonClasses = [...new Set(cours().filter((e) => e.module && !matiereDe(e)).map((e) => e.module))].sort();
		let html = "";
		for (const ue of ues()) {
			const prochains = cours().filter((e) => e.debut > now && appartient(matiereDe(e), ue.code)).slice(0, 3);
			const ts = tachesOuvertes().filter((t) => t.matiere && appartient(t.matiere, ue.code));
			const nCours = cours().filter((e) => e.debut > now && appartient(matiereDe(e), ue.code)).length;
			html += `<details class="carte ue" style="--c:${couleur(ue.code)}"><summary>
				<span style="display:flex;gap:12px;align-items:center"><span class="pastille-ue">${h(ue.code)}</span><span><span class="ue-nom">${h(ue.nom || ue.code)}</span><br><span class="petit">${nCours} cours à venir${ts.length ? ` · ${ts.length} tâche(s)` : ""}</span></span></span>
				<span class="petit">›</span></summary>
				<div class="ue-int">
				${ue.drive ? `<div class="liens"><a href="${h(ue.drive)}" target="_blank" rel="noopener">📂 Cours sur le Drive</a></div>` : ""}
				${(ue.matieres || []).map((m) => {
					const lib = `${ue.code} / ${m.nom}`;
					const n = tachesOuvertes().filter((t) => t.matiere === lib).length;
					return `<div class="ligne"><div class="corps"><div class="t">${h(m.nom)}</div><div class="s">${n ? n + " tâche(s)" : ""}${n && m.drive ? " · " : ""}${m.drive ? `<a href="${h(m.drive)}" target="_blank" rel="noopener">Cours</a>` : ""}</div></div>
						<button class="bouton petit-b" data-tache-pour="${h(lib)}">+ Tâche</button></div>`;
				}).join("")}
				${prochains.length ? `<h2 style="margin-top:14px">Prochains cours</h2>${prochains.map(ligneCours).join("")}` : ""}
				${ts.length ? `<h2 style="margin-top:14px">Tâches</h2>${ts.map(ligneTache).join("")}` : ""}
				<div class="liens" style="margin-top:12px"><button class="bouton petit-b" data-tache-pour="${h(ue.code)}">+ Tâche pour ${h(ue.code)}</button></div>
				</div>
			</details>`;
		}
		if (nonClasses.length) {
			const opts = listeMatieres().map((l) => `<option value="${h(l)}">${h(l)}</option>`).join("");
			html += `<section class="carte" style="margin-top:16px"><h2>Modules Lise à classer</h2><p class="petit">Rattache chaque module de l'emploi du temps à une UE ou une matière. Une seule fois suffit.</p>
				${nonClasses.map((m) => `<div class="ligne"><div class="corps"><div class="t">${h(m)}</div></div><select data-classer="${h(m)}" style="max-width:55%"><option value="">Choisir…</option>${opts}</select></div>`).join("")}</section>`;
		}
		return `<div class="grille">${html || '<p class="vide">Aucune UE configurée.</p>'}</div>`;
	},

	reglages() {
		const cfg = S.data.config;
		const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/");
		const lien = cfg.icsName ? `${base}cal/${cfg.icsName}.ics` : "";
		return `<div class="grille deux">
			<section class="carte"><h2>Calendrier Apple</h2>
				${lien ? `<p>Abonne-toi une fois sur chaque appareil : cours Lise, partiels et tâches s'y mettent à jour toutes les heures.</p>
				<a class="bouton plein large" style="display:block;text-align:center;text-decoration:none" href="${h(lien.replace(/^https?:/, "webcal:"))}">S'abonner dans Calendrier</a>
				<p class="petit">Dans la fenêtre qui s'ouvre, désactive « Supprimer les alertes » pour recevoir les rappels des tâches et des partiels.</p>
				<div class="code-lien">${h(lien)}</div>
				<button class="bouton" style="margin-top:8px" data-copier="${h(lien)}">Copier le lien</button>` : '<p class="vide">Lien pas encore disponible.</p>'}
			</section>
			<section class="carte"><h2>Synchronisation</h2>
				<p class="petit">Identifiant Lise : ${h(cfg.liseId || "—")} · Demi-troupe : ${h(cfg.groupe || "—")}</p>
				<button class="bouton large" data-recharger>Recharger maintenant</button>
				<button class="bouton large" style="margin-top:8px" data-forcer>Relancer la synchro Lise</button>
				<label for="tok">Code d'accès GitHub</label>
				<input id="tok" type="password" autocomplete="off" placeholder="${S.token ? "•••••• enregistré" : "github_pat_…"}">
				<div class="actions"><button class="bouton plein" data-token>Enregistrer</button><button class="bouton danger" data-deconnexion>Oublier sur cet appareil</button></div>
			</section>
		</div>`;
	},
};

function ecranConnexion() {
	return `<div class="accueil-connexion carte">
		<h3>Bienvenue 👋</h3>
		<p>Pour synchroniser ton iPad et ton iPhone, l'app a besoin de ton <strong>code d'accès GitHub</strong> (à créer une seule fois, puis à coller sur chaque appareil).</p>
		<label for="tok0">Code d'accès</label>
		<input id="tok0" type="password" autocomplete="off" placeholder="github_pat_…">
		<div class="actions"><button class="bouton plein" data-token0>Se connecter</button></div>
		<p class="petit">Le code reste sur cet appareil et ne sert qu'à lire et écrire dans ton dépôt privé <em>appli-ensam-data</em>.</p>
	</div>`;
}

// ---------- Feuilles (formulaires) ----------
function ouvrirFeuille(html) { $("#feuille-corps").innerHTML = html; $("#feuille").hidden = false; formules($("#feuille-corps")); }
function fermerFeuille() { $("#feuille").hidden = true; $("#feuille-corps").innerHTML = ""; }

function formTache(t = {}, prefill = {}) {
	const v = { ...prefill, ...t };
	const cle = v.echeance ? (v.echeance.length > 10 ? jourCle(v.echeance) : v.echeance) : "";
	const hm = v.echeance && v.echeance.length > 10 ? heure(v.echeance) : "";
	const opts = ['<option value="">— Aucune —</option>', ...listeMatieres().map((l) => `<option ${l === v.matiere ? "selected" : ""}>${h(l)}</option>`)].join("");
	const prochain = v.module ? cours().find((e) => e.module === v.module && e.debut > new Date().toISOString() && e.uid !== v.coursUid) : null;
	ouvrirFeuille(`<h3>${t.id ? "Modifier la tâche" : "Nouvelle tâche"}</h3>
		<form id="f-tache">
			<label for="ft-titre">Quoi ?</label><input id="ft-titre" type="text" required value="${h(v.titre || "")}" placeholder="Exercices 3 à 5 du TD">
			<label for="ft-mat">Matière</label><select id="ft-mat">${opts}</select>
			<div class="rang"><div><label for="ft-date">Pour le</label><input id="ft-date" type="date" value="${h(cle)}"></div>
			<div><label for="ft-h">Heure (facultatif)</label><input id="ft-h" type="time" value="${h(hm)}"></div></div>
			${t.coursLie ? `<p class="petit" style="margin-top:10px">Liée au cours : ${h(t.coursLie.titre)} (${h(libelleJour(jourCle(t.coursLie.debut)))} ${heure(t.coursLie.debut)}) · <a href="#" data-changer-cours>changer</a></p>` : ""}
			${prochain ? `<button type="button" class="bouton" style="margin-top:8px" data-prochain="${h(prochain.uid)}">Pour le prochain cours (${h(libelleJour(jourCle(prochain.debut)))} ${heure(prochain.debut)})</button>` : ""}
			<label for="ft-note">Note</label><textarea id="ft-note" placeholder="Détails, pages, consignes…">${h(v.note || "")}</textarea>
			<div class="actions">${t.id ? '<button type="button" class="bouton danger" data-suppr-tache>Supprimer</button>' : '<button type="button" class="bouton" data-fermer>Annuler</button>'}<button class="bouton plein">Enregistrer</button></div>
		</form>`);
	const f = $("#f-tache");
	let lie = t.coursLie || null;
	if (!lie && v.coursUid) { const c = cours().find((x) => x.uid === v.coursUid); if (c) lie = { uid: c.uid, debut: c.debut, titre: c.titre }; }
	f.querySelector("[data-prochain]")?.addEventListener("click", (e) => {
		const c = cours().find((x) => x.uid === e.currentTarget.dataset.prochain);
		if (!c) return;
		$("#ft-date").value = jourCle(c.debut); $("#ft-h").value = heure(c.debut);
		lie = { uid: c.uid, debut: c.debut, titre: c.titre };
		e.currentTarget.textContent = "✓ Échéance au prochain cours";
	});
	f.querySelector("[data-changer-cours]")?.addEventListener("click", (e) => { e.preventDefault(); fermerFeuille(); feuilleReattribuer(t); });
	f.querySelector("[data-suppr-tache]")?.addEventListener("click", () => {
		if (!confirm("Supprimer cette tâche ?")) return;
		fermerFeuille();
		action(() => modifier("tasks.json", "tasks", (l) => l.filter((x) => x.id !== t.id), `Suppression tâche : ${t.titre}`));
	});
	f.addEventListener("submit", (e) => {
		e.preventDefault();
		const titre = $("#ft-titre").value.trim();
		if (!titre) return;
		const date = $("#ft-date").value, hh = $("#ft-h").value;
		const tache = {
			id: t.id || uid(), titre, matiere: $("#ft-mat").value, note: $("#ft-note").value.trim(),
			echeance: date ? (hh ? parisIso(date, hh) : date) : "", fait: t.fait || false,
			coursUid: lie?.uid || v.coursUid || "", module: v.module || "", creeLe: t.creeLe || new Date().toISOString(),
			coursLie: lie,
		};
		fermerFeuille();
		action(() => modifier("tasks.json", "tasks", (l) => { const i = l.findIndex((x) => x.id === tache.id); if (i >= 0) l[i] = { ...l[i], ...tache }; else l.push(tache); return l; }, `${t.id ? "Modification" : "Nouvelle"} tâche : ${titre}`));
	});
	setTimeout(() => $("#ft-titre")?.focus(), 50);
}

function choixChapitres(p) {
	const chs = Object.values(R.chap || {}).filter((c) => !c.partiel);
	const choisis = new Set(p.chapitres || chapitresAuto(p.matiere).map((c) => c.id));
	const parUe = {};
	chs.forEach((c) => (parUe[c.ue] ||= []).push(c));
	return Object.entries(parUe).map(([ue, l]) => `<div class="section-titre" style="margin-top:10px">${h(ue)}</div>${l.map((c) => `<label class="choix"><input type="checkbox" name="fp-ch" value="${h(c.id)}" ${choisis.has(c.id) ? "checked" : ""}><span>${h(c.titre)}</span></label>`).join("")}`).join("") || '<p class="petit">Aucun chapitre de révision pour l\'instant.</p>';
}
function formPartiel(p = {}) {
	const lise = !!p.liseUid;
	const opts = ['<option value="">— Aucune —</option>', ...listeMatieres().map((l) => `<option ${l === p.matiere ? "selected" : ""}>${h(l)}</option>`)].join("");
	const perso = Array.isArray(p.chapitres) && p.chapitres.length > 0;
	ouvrirFeuille(`<h3>${p.id && !lise ? "Modifier le partiel" : lise ? "Personnaliser le partiel" : "Nouveau partiel"}</h3>
		${lise ? `<p class="petit">Partiel venant de Lise : la date et l'heure se mettent à jour toutes seules.</p>` : ""}
		<form id="f-partiel">
			<label for="fp-titre">Intitulé</label><input id="fp-titre" type="text" required value="${h(p.titre || "")}" placeholder="Partiel MMC">
			<label for="fp-mat">Matière</label><select id="fp-mat">${opts}</select>
			${lise ? "" : `<label for="fp-date">Date</label><input id="fp-date" type="date" required value="${h(p.date || "")}">
			<div class="rang"><div><label for="fp-h1">Début</label><input id="fp-h1" type="time" value="${h(p.heureDebut || "")}"></div><div><label for="fp-h2">Fin</label><input id="fp-h2" type="time" value="${h(p.heureFin || "")}"></div></div>
			<label for="fp-salle">Salle</label><input id="fp-salle" type="text" value="${h(p.salle || "")}">`}
			<label for="fp-desc">Ce qui tombe (attendus, consignes du prof, documents autorisés…)</label>
			<textarea id="fp-desc" placeholder="Ex. : chapitres 1 à 3, flexion et torsion, calculatrice autorisée, un exercice de Castigliano…">${h(p.description || "")}</textarea>
			<label>Contenu du module de révision</label>
			<label class="choix"><input type="radio" name="fp-mode" value="auto" ${perso ? "" : "checked"}><span><b>Automatique</b><br><span class="petit">Tous les chapitres de la matière choisie</span></span></label>
			<label class="choix"><input type="radio" name="fp-mode" value="choix" ${perso ? "checked" : ""}><span><b>Je choisis</b><br><span class="petit">Coche les chapitres au programme</span></span></label>
			<div id="fp-chs" ${perso ? "" : "hidden"}>${choixChapitres(p)}</div>
			<div class="actions">${p.id && !lise ? '<button type="button" class="bouton danger" data-suppr-partiel>Supprimer</button>' : '<button type="button" class="bouton" data-fermer>Annuler</button>'}<button class="bouton plein">Enregistrer</button></div>
		</form>`);
	const f = $("#f-partiel");
	f.querySelectorAll('[name="fp-mode"]').forEach((r) => r.addEventListener("change", () => { $("#fp-chs").hidden = f.querySelector('[name="fp-mode"]:checked').value !== "choix"; }));
	$("#fp-mat").addEventListener("change", () => { if (f.querySelector('[name="fp-mode"]:checked').value === "auto") $("#fp-chs").innerHTML = choixChapitres({ matiere: $("#fp-mat").value }); });
	f.querySelector("[data-suppr-partiel]")?.addEventListener("click", () => {
		if (!confirm("Supprimer ce partiel ?")) return;
		fermerFeuille();
		R.partiel = null;
		action(() => modifier("partiels.json", "partiels", (l) => l.filter((x) => x.id !== p.id), `Suppression partiel : ${p.titre}`));
	});
	f.addEventListener("submit", (e) => {
		e.preventDefault();
		const mode = f.querySelector('[name="fp-mode"]:checked').value;
		const chapitres = mode === "choix" ? [...f.querySelectorAll('[name="fp-ch"]:checked')].map((c) => c.value) : null;
		const commun = { titre: $("#fp-titre").value.trim(), matiere: $("#fp-mat").value, description: $("#fp-desc").value.trim(), chapitres };
		const np = lise
			? { id: p.surchargeId || uid(), liseUid: p.liseUid, ...commun }
			: { id: p.id || uid(), coursUid: p.coursUid || "", ...commun, date: $("#fp-date").value, heureDebut: $("#fp-h1").value, heureFin: $("#fp-h2").value, salle: $("#fp-salle").value.trim(), note: p.note || "" };
		if (!np.titre || (!lise && !np.date)) return;
		fermerFeuille();
		action(async () => {
			await modifier("partiels.json", "partiels", (l) => { const i = l.findIndex((x) => x.id === np.id); if (i >= 0) l[i] = np; else l.push(np); return l; }, `Partiel : ${np.titre}`);
			R.partiel = lise ? "lise-" + p.liseUid : np.id;
			R.session = null; R.ouvert = null;
			location.hash = "#reviser";
		});
	});
}

function detailCours(e) {
	const mat = matiereDe(e);
	const liees = (S.data.tasks || []).filter((t) => t.coursUid === e.uid || (t.module && t.module === e.module && !t.fait));
	ouvrirFeuille(`<h3>${h(e.titre)}</h3>
		<p class="petit">${h(libelleJour(jourCle(e.debut)))} · ${e.journee ? "journée" : heure(e.debut) + " – " + heure(e.fin)}</p>
		<div class="carte" style="margin-top:10px">
			${[["Type", e.type], ["Salle", e.salle], ["Intervenants", e.profs], ["Module", e.module], ["Groupes", e.groupes], ["Matière", mat || "non classée"]].filter((x) => x[1]).map(([k, v]) => `<div class="ligne"><div class="heure">${k}</div><div class="corps">${h(v)}</div></div>`).join("")}
		</div>
		${liees.length ? `<h2 class="petit" style="margin-top:14px">TÂCHES LIÉES</h2><div class="carte">${liees.map(ligneTache).join("")}</div>` : ""}
		<div class="actions"><button class="bouton" data-fermer>Fermer</button><button class="bouton plein" data-tache-cours="${h(e.uid)}">+ Tâche pour ce cours</button></div>
		${e.examen ? "" : `<button class="bouton large" style="margin-top:10px" data-partiel-cours="${h(e.uid)}">🎓 Ajouter comme partiel</button>`}`);
}

// ---------- Rendu et évènements ----------
const TITRES = { notes: "Mes notes", accueil: "Accueil", agenda: "Agenda", taches: "Tâches", reviser: "Réviser", matieres: "Matières", reglages: "Réglages" };
function rendre() {
	const v = (location.hash.slice(1) || "accueil");
	S.vue = VUES[v] ? v : "accueil";
	$("#titre").textContent = TITRES[S.vue];
	document.querySelectorAll("#onglets a").forEach((a) => a.classList.toggle("actif", a.dataset.v === S.vue));
	$("#btn-ajout").hidden = !S.token || S.vue === "reviser" || S.vue === "notes";
	$("#onglets").hidden = !S.token;
	$("#vue").innerHTML = S.token ? VUES[S.vue]() : ecranConnexion();
	formules($("#vue"));
}

async function enregistrerToken(val) {
	const t = val.trim();
	if (!t) return;
	S.token = t;
	const res = await api(`repos/${DATA_REPO}`).catch(() => null);
	if (!res || !res.ok) { S.token = store.get("ae.token"); alerteDouce("Code refusé : vérifie qu'il donne accès à appli-ensam-data."); rendre(); return; }
	store.set("ae.token", t);
	bandeau(null);
	rendre();
	await charger();
}

document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-fermer],[data-cours],[data-tache],[data-partiel],[data-semaine],[data-seg],[data-nouveau-partiel],[data-tache-pour],[data-tache-cours],[data-copier],[data-recharger],[data-forcer],[data-token],[data-token0],[data-deconnexion],[data-suivre],[data-reattribuer],[data-garder],[data-partiel-cours],[data-partiel-voir]");
	if (!el) return;
	const d = el.dataset;
	if ("fermer" in d) return fermerFeuille();
	if (d.cours) { const ev = cours().find((x) => x.uid === d.cours); if (ev) detailCours(ev); return; }
	if (d.tache) { const t = S.data.tasks.find((x) => x.id === d.tache); if (t) formTache(t); return; }
	if (d.partiel) { const p = S.data.partiels.find((x) => x.id === d.partiel); if (p) formPartiel(p); return; }
	if (d.partielVoir) { R.partiel = d.partielVoir; R.session = null; R.ouvert = null; fermerFeuille(); if (location.hash !== "#reviser") location.hash = "#reviser"; else rendre(); window.scrollTo(0, 0); return; }
	if (d.semaine !== undefined) { S.semaine = d.semaine === "0" ? 0 : S.semaine + Number(d.semaine); return rendre(); }
	if (d.seg) { S.segTaches = d.seg; return rendre(); }
	if ("nouveauPartiel" in d) return formPartiel();
	if (d.tachePour) return formTache({}, { matiere: d.tachePour });
	if (d.suivre) {
		const t = S.data.tasks.find((x) => x.id === d.suivre);
		const ev = t && cours().find((x) => x.uid === t.coursLie.uid);
		if (!ev) return;
		const suivaitEcheance = t.echeance && t.echeance.length > 10 && t.echeance === t.coursLie.debut;
		const memeJour = t.echeance && t.echeance.length <= 10 && t.echeance === jourCle(t.coursLie.debut);
		return action(() => modifier("tasks.json", "tasks", (l) => l.map((x) => x.id !== t.id ? x : {
			...x, coursLie: { ...x.coursLie, debut: ev.debut }, echeance: suivaitEcheance ? ev.debut : memeJour ? jourCle(ev.debut) : x.echeance,
		}), `Cours déplacé : ${t.titre}`));
	}
	if (d.reattribuer) { const t = S.data.tasks.find((x) => x.id === d.reattribuer); if (t) feuilleReattribuer(t); return; }
	if (d.garder) {
		const id = d.garder;
		return action(() => modifier("tasks.json", "tasks", (l) => l.map((x) => x.id !== id ? x : { ...x, coursLie: { ...x.coursLie, ignore: true } }), "Tâche conservée"));
	}
	if (d.partielCours) {
		const ev = cours().find((x) => x.uid === d.partielCours);
		if (!ev) return;
		fermerFeuille();
		return formPartiel({ titre: ev.titre, matiere: matiereDe(ev), date: jourCle(ev.debut), heureDebut: ev.journee ? "" : heure(ev.debut), heureFin: ev.journee ? "" : heure(ev.fin), salle: salle(ev.salle), coursUid: ev.uid });
	}
	if (d.tacheCours) {
		const ev = cours().find((x) => x.uid === d.tacheCours);
		fermerFeuille();
		return formTache({}, { matiere: matiereDe(ev), coursUid: ev.uid, module: ev.module, titre: "", echeance: ev.journee ? jourCle(ev.debut) : ev.debut });
	}
	if (d.copier) { navigator.clipboard?.writeText(d.copier).then(() => alerteDouce("Lien copié."), () => {}); return; }
	if ("recharger" in d) return charger().then(() => alerteDouce("À jour."));
	if ("forcer" in d) {
		return api(`repos/${APP_REPO}/actions/workflows/sync.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) })
			.then((r) => alerteDouce(r.ok ? "Synchro lancée : résultat d'ici 1 à 2 minutes." : "Impossible de lancer la synchro (droit « Actions » manquant sur le code ?)."))
			.catch(() => alerteDouce("Hors ligne."));
	}
	if ("token" in d) return enregistrerToken($("#tok").value);
	if ("token0" in d) return enregistrerToken($("#tok0").value);
	if ("deconnexion" in d) { if (confirm("Oublier le code d'accès sur cet appareil ?")) { store.del("ae.token"); store.del("ae.cache"); S.token = null; rendre(); } }
});

document.addEventListener("change", (e) => {
	const c = e.target;
	if (c.dataset.cocher) {
		const id = c.dataset.cocher, fait = c.checked;
		action(() => modifier("tasks.json", "tasks", (l) => l.map((t) => (t.id === id ? { ...t, fait, faitLe: fait ? new Date().toISOString() : "" } : t)), fait ? "Tâche terminée" : "Tâche rouverte"));
	}
	if (c.dataset.classer && c.value) {
		const mod = c.dataset.classer, val = c.value;
		action(() => modifier("config.json", "config", (cfg) => { cfg.modules = { ...(cfg.modules || {}), [mod]: val }; return cfg; }, `Classement du module ${mod}`));
	}
});
document.addEventListener("toggle", (e) => { if (e.target.matches?.("[data-faites]")) S.voirFaites = e.target.open; }, true);

$("#btn-ajout").addEventListener("click", () => (S.vue === "taches" && S.segTaches === "partiels" ? formPartiel() : formTache()));
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); rendre(); });
document.querySelector('#onglets a[data-v="reviser"]').addEventListener("click", () => { if (S.vue === "reviser" && !R.session) { R.ouvert = null; R.partiel = null; rendre(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") charger(); });
window.addEventListener("online", () => charger());
setInterval(() => { if (document.visibilityState === "visible") charger(); }, 5 * 60e3);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
initRevisionCache();
rendre();
charger();
window.addEventListener("katex", () => formules($("#vue")));
