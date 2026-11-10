"use strict";
// Section Réviser : cartes à répétition espacée, fiches, équations, définitions, textes à trous,
// calculs, principes à expliquer (Feynman), résumés à faire valider, QCM, vidage de mémoire.
// Chargé avant app.js : les fonctions ne s'exécutent qu'après le démarrage de l'app.

const R = {
	chap: {}, // id → chapitre
	session: null, // { titre, cles:[], i, repondu }
	ouvert: null, // id du chapitre affiché
	brouillons: null,
	chrono: null,
};
const BOITES = [0, 1, 3, 7, 16, 35]; // jours avant la prochaine révision, par boîte (méthode Leitner)
const TYPES = {
	flash: "Carte", definition: "Définition", equation: "Équation", fiche: "Fiche mémo", trous: "Texte à trous",
	calcul: "Calcul", principe: "Principe à expliquer", resume: "Résumé à faire", qcm: "QCM", memoire: "Vidage de mémoire",
};
const RECALL = ["flash", "definition", "equation"];
const EXOS = ["qcm", "trous", "calcul", "principe"];

// ---------- Données ----------
async function chargerRevision() {
	const idx = await lire("revision/index.json", { chapitres: [] });
	const progres = await lire("revision/progres.json", {});
	const rendus = await lire("revision/rendus.json", []);
	const chs = await Promise.all((idx.chapitres || []).map((c) => lire(`revision/chapitres/${c.id}.json`, null).catch(() => null)));
	S.data.revision = { index: idx, rendus };
	S.data.progres = fusionProgres(progres, store.get("ae.progres.local", {}));
	R.chap = {};
	chs.forEach((c) => { if (c) R.chap[c.id] = c; });
	store.set("ae.chap", R.chap);
}
function initRevisionCache() {
	if (!S.data.revision) S.data.revision = { index: { chapitres: [] }, rendus: [] };
	if (!S.data.progres) S.data.progres = {};
	R.chap = store.get("ae.chap", {});
	R.brouillons = store.get("ae.brouillons", {});
}
function fusionProgres(a = {}, b = {}) {
	const out = { ...a };
	for (const [k, v] of Object.entries(b)) if (!out[k] || (v.maj || "") > (out[k].maj || "")) out[k] = v;
	return out;
}
let progresTimer;
function sauverProgres() {
	store.set("ae.progres.local", S.data.progres);
	clearTimeout(progresTimer);
	progresTimer = setTimeout(async () => {
		try {
			const local = S.data.progres;
			await modifier("revision/progres.json", "progres", (dist) => fusionProgres(dist, local), "Progrès de révision", { defaut: {}, sansSynchro: true });
			store.set("ae.progres.local", {});
		} catch {}
	}, 8000);
}
const cle = (chapId, itemId) => `${chapId}:${itemId}`;
function item(k) { const [c, i] = k.split(":"); const ch = R.chap[c]; return ch && { ch, it: (ch.items || []).find((x) => x.id === i) }; }
function noter(k, niveau) {
	// niveau : 0 = raté, 1 = juste, 2 = facile
	const p = S.data.progres[k] || { boite: 0, vu: 0, ok: 0, ko: 0 };
	p.vu++;
	if (niveau === 0) { p.boite = 1; p.ko++; } else { p.boite = Math.min(5, (p.boite || 0) + niveau); p.ok++; }
	p.prochaine = ajouterJours(auj(), BOITES[p.boite]);
	p.maj = new Date().toISOString();
	S.data.progres[k] = p;
	sauverProgres();
}
const estDu = (k) => { const p = S.data.progres[k]; return !p || !p.prochaine || p.prochaine <= auj(); };
const tousItems = () => Object.values(R.chap).flatMap((ch) => (ch.items || []).map((it) => ({ ch, it, k: cle(ch.id, it.id) })));
function maitrise(ch) {
	const its = (ch.items || []).filter((it) => RECALL.includes(it.type) || EXOS.includes(it.type));
	if (!its.length) return 0;
	const s = its.reduce((a, it) => a + Math.min(1, ((S.data.progres[cle(ch.id, it.id)] || {}).boite || 0) / 3), 0);
	return Math.round((100 * s) / its.length);
}
function partielDe(ch) {
	const p = partielsTous().find((x) => jourCle(x.debut) >= auj() && x.matiere && appartient(x.matiere, ch.ue));
	return p ? joursEntre(auj(), jourCle(p.debut)) : null;
}

// ---------- Texte et formules ----------
function md(t = "") {
	const lignes = h(t).split("\n");
	let html = "", liste = false;
	for (const l of lignes) {
		const b = l.match(/^\s*[-•]\s+(.*)/);
		if (b) { if (!liste) { html += "<ul>"; liste = true; } html += `<li>${inline(b[1])}</li>`; continue; }
		if (liste) { html += "</ul>"; liste = false; }
		if (/^###\s/.test(l)) html += `<h4>${inline(l.replace(/^###\s/, ""))}</h4>`;
		else if (l.trim()) html += `<p>${inline(l)}</p>`;
	}
	return html + (liste ? "</ul>" : "");
}
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<i>$2</i>");
function formules(el) {
	if (!el || !window.renderMathInElement) return;
	try {
		window.renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
	} catch {}
}
function proche(a, b) {
	// vrai si a et b diffèrent d'au plus une lettre (mots de 6 lettres ou plus)
	if (a === b) return true;
	if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
	let i = 0, j = 0, diff = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) { i++; j++; continue; }
		if (++diff > 1) return false;
		if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
	}
	return diff + (a.length - i) + (b.length - j) <= 1;
}
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function nombre(s) { const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").replace(/×10\^?/, "e")); return isNaN(v) ? null : v; }
const src = (it, ch) => (it.source || ch.sources?.[0]?.fichier ? `<div class="r-src">Source : ${h([ch.sources?.[0]?.fichier, it.source].filter(Boolean).join(" · "))}</div>` : "");

function lienClaude(ch, it, extra = "") {
	const contexte = `Je suis étudiant à l'ENSAM et je révise « ${ch.titre} » (${ch.ue}${ch.matiere ? " / " + ch.matiere : ""}).`;
	let corps = "";
	if (it.type === "calcul") corps = `Voici l'exercice :\n${it.enonce}${it.donnees ? "\nDonnées : " + it.donnees : ""}${extra ? "\n\nMa démarche :\n" + extra : ""}\n\nGuide-moi étape par étape sans me donner directement la réponse : pose-moi des questions, vérifie mes calculs et mes unités.`;
	else if (it.type === "principe") corps = `Je dois expliquer ce principe : ${it.question}\n\nVoici mon explication :\n${extra || "(pas encore écrite)"}\n\nCorrige-la comme un professeur : ce qui est juste, ce qui manque, ce qui est faux, avec un exemple concret.`;
	else if (it.type === "resume" || it.type === "memoire") corps = `Consigne : ${it.consigne}\n\nVoici mon résumé :\n${extra || "(pas encore écrit)"}\n\nValide-le : points clés présents, oublis, erreurs, et note sur 10.`;
	else if (it.type === "qcm") corps = `QCM : ${it.question}\nChoix : ${it.choix.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join(" ; ")}\n\nExplique-moi le raisonnement sans me donner tout de suite la réponse.`;
	else corps = `Explique-moi en détail, avec un exemple concret : ${it.recto || it.terme || it.nom || it.question || it.titre || ""}`;
	return "https://claude.ai/new?q=" + encodeURIComponent(`${contexte}\n\n${corps}\n\nAppuie-toi sur le cours de mon professeur et signale toute hypothèse.`);
}
const boutonClaude = (ch, it, extra) => `<a class="bouton petit-b r-claude" href="${h(lienClaude(ch, it, extra))}" target="_blank" rel="noopener" data-r-claude="${h(cle(ch.id, it.id))}">✦ Résoudre avec Claude</a>`;


// ---------- Photo d'une résolution (compressée avant envoi) ----------
R.photos = {};
function compresserImage(fichier, max = 1600) {
	return new Promise((ok, ko) => {
		const img = new Image();
		img.onload = () => {
			const r = Math.min(1, max / Math.max(img.width, img.height));
			const cv = document.createElement("canvas");
			cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
			cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
			ok(cv.toDataURL("image/jpeg", 0.75));
			URL.revokeObjectURL(img.src);
		};
		img.onerror = ko;
		img.src = URL.createObjectURL(fichier);
	});
}
async function envoyerImage(chemin, dataUrl, message) {
	const res = await api(`repos/${DATA_REPO}/contents/${chemin}`, { method: "PUT", body: JSON.stringify({ message, content: dataUrl.split(",")[1] }) });
	if (!res.ok) throw new Error(`Envoi de la photo impossible (${res.status})`);
}
const zonePhoto = (k) => `<label class="bouton petit-b r-photo-b">📷 Photo<input type="file" accept="image/*" data-r-photo="${h(k)}" hidden></label><div class="r-apercu" id="p-${h(k)}"></div>`;

// ---------- Rendu d'un élément ----------
function carteItem(ch, it, mode = "liste") {
	const k = cle(ch.id, it.id);
	const tete = `<div class="r-type" style="--c:${couleur(ch.ue)}">${TYPES[it.type] || it.type}</div>`;
	const indices = (it.indices || []).length ? `<button class="bouton petit-b" data-r-indice="${h(k)}">💡 Indice</button><div class="r-indices" id="ind-${h(k)}"></div>` : "";
	switch (it.type) {
		case "fiche":
			return `<div class="r-carte">${tete}<h3>${h(it.titre)}</h3><div class="r-md">${md(it.contenu)}</div>
${src(it, ch)}</div>`;
		case "equation":
			if (mode === "session") return `<div class="r-carte">${tete}<h3>${h(it.nom)}</h3>${it.quand ? `<p class="petit">${h(it.quand)}</p>` : ""}
				<p>Écris la formule de tête, puis vérifie.</p><div class="r-cache" id="v-${h(k)}" hidden>${formuleBloc(it)}</div>
				<div class="r-actions"><button class="bouton plein" data-r-montrer="${h(k)}">Voir la formule</button></div>${notation(k)}</div>`;
			return `<div class="r-carte">${tete}<h3>${h(it.nom)}</h3>${formuleBloc(it)}${it.quand ? `<p class="petit">${h(it.quand)}</p>` : ""}${src(it, ch)}</div>`;
		case "definition":
		case "flash": {
			const recto = it.type === "flash" ? it.recto : it.terme, verso = it.type === "flash" ? it.verso : it.definition;
			if (mode === "liste" && it.type === "definition") return `<div class="r-carte">${tete}<h3>${h(recto)}</h3><div class="r-md">${md(verso)}</div>${src(it, ch)}</div>`;
			return `<div class="r-carte r-flash">${tete}<div class="r-recto">${md(recto)}</div>
				<div class="r-cache" id="v-${h(k)}" hidden><hr><div class="r-md">${md(verso)}</div>${src(it, ch)}</div>
				<div class="r-actions"><button class="bouton plein" data-r-montrer="${h(k)}">Retourner la carte</button></div>${notation(k)}</div>`;
		}
		case "qcm":
			return `<div class="r-carte">${tete}<div class="r-md">${md(it.question)}</div>
				<div class="r-choix">${it.choix.map((c, i) => `<button class="r-choix-b" data-r-qcm="${h(k)}" data-i="${i}">${String.fromCharCode(65 + i)}. ${inline(h(c))}</button>`).join("")}</div>
				<div class="r-retour" id="r-${h(k)}"></div><div class="r-actions">${boutonClaude(ch, it)}</div></div>`;
		case "trous": {
			let n = 0;
			const html = h(it.texte).replace(/\[\[(.+?)\]\]/g, (_, rep) => `<input class="r-trou" data-rep="${rep}" data-n="${n++}" size="${Math.max(4, rep.split("|")[0].length)}" autocomplete="off" autocapitalize="off" spellcheck="false">`);
			return `<div class="r-carte">${tete}${it.titre ? `<h3>${h(it.titre)}</h3>` : ""}<div class="r-trous" id="t-${h(k)}">${html}</div>
				<div class="r-retour" id="r-${h(k)}"></div>
				<div class="r-actions"><button class="bouton plein" data-r-trous="${h(k)}">Vérifier</button><button class="bouton petit-b" data-r-solution="${h(k)}">Réponses</button></div>${src(it, ch)}</div>`;
		}
		case "calcul":
			return `<div class="r-carte">${tete}<div class="r-md">${md(it.enonce)}</div>${it.donnees ? `<div class="r-donnees">${md(it.donnees)}</div>` : ""}
				<div class="r-rep"><input type="text" inputmode="decimal" id="c-${h(k)}" placeholder="Ta réponse"><span>${h(it.reponse?.unite || "")}</span></div>
				<div class="r-retour" id="r-${h(k)}"></div>
				<div class="r-actions"><button class="bouton plein" data-r-calcul="${h(k)}">Vérifier</button>${indices}</div>
				<div class="r-actions">${boutonClaude(ch, it)}<button class="bouton petit-b" data-r-solution="${h(k)}">Solution</button></div>
				<div class="r-cache" id="s-${h(k)}" hidden><div class="r-md">${md(it.solution || "")}</div></div>
				<details class="r-rendu"><summary class="petit">📤 Rendre une résolution complète (texte ou photo) pour correction</summary>
					<textarea class="r-texte" id="x-${h(k)}" data-r-brouillon="${h(k)}" placeholder="Écris ta démarche, ou joins une photo de ta feuille / ton schéma…">${h((R.brouillons || {})[k] || "")}</textarea>
					<div class="r-actions">${zonePhoto(k)}<button class="bouton plein petit-b" data-r-envoyer="${h(k)}">Envoyer pour correction</button><a class="bouton petit-b" href="#" data-r-claude-txt="${h(k)}">✦ Corriger avec Claude</a></div>
					${statutRendu(k)}
				</details>${src(it, ch)}</div>`;
		case "principe":
		case "resume":
		case "memoire": {
			const q = it.type === "principe" ? it.question : it.consigne;
			return `<div class="r-carte">${tete}<div class="r-md">${md(q)}</div>
				${it.type === "memoire" ? `<p class="petit">Sans regarder le cours : écris tout ce dont tu te souviens, puis compare. <button class="bouton petit-b" data-r-chrono="${h(k)}">⏱ Lancer 5 min</button> <span id="ch-${h(k)}"></span></p>` : ""}
				<textarea class="r-texte" id="x-${h(k)}" data-r-brouillon="${h(k)}" placeholder="${it.type === "principe" ? "Explique avec tes mots, comme à un camarade…" : "Écris ton résumé ici…"}">${h((R.brouillons || {})[k] || "")}</textarea>
				<div class="r-actions">${indices}<button class="bouton plein" data-r-comparer="${h(k)}">Comparer aux points clés</button></div>
				<div class="r-cache" id="v-${h(k)}" hidden></div>
				<div class="r-actions">${zonePhoto(k)}<button class="bouton petit-b" data-r-envoyer="${h(k)}">📤 Envoyer pour validation</button><a class="bouton petit-b" href="#" data-r-claude-txt="${h(k)}">✦ Valider avec Claude</a></div>
				${statutRendu(k)}
				${src(it, ch)}</div>`;
		}
	}
	return "";
}
function statutRendu(k) {
	const rendu = (S.data.revision.rendus || []).filter((r) => r.cle === k).sort((a, b) => b.date.localeCompare(a.date))[0];
	if (!rendu) return "";
	return `<div class="r-statut ${rendu.statut}">${rendu.statut === "en_attente" ? "⏳ Envoyé le " + h(fmt(rendu.date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + " · correction cette nuit" : rendu.statut === "valide" ? "✅ Validé" : "✏️ À retravailler"}${rendu.note != null ? ` · ${h(rendu.note)}/10` : ""}${rendu.image ? " · 📷 photo jointe" : ""}${rendu.retour ? `<div class="r-md">${md(rendu.retour)}</div>` : ""}</div>`;
}
function formuleBloc(it) {
	return `<div class="r-formule">$$${h(it.formule)}$$</div>${(it.variables || []).length ? `<table class="r-vars">${it.variables.map(([s, sens, u]) => `<tr><td>$${h(s)}$</td><td>${h(sens)}</td><td class="petit">${h(u || "")}</td></tr>`).join("")}</table>` : ""}`;
}
function notation(k) {
	return `<div class="r-notes" id="n-${h(k)}" hidden><span class="petit">Tu la connaissais ?</span>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="0">À revoir</button>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="1">Bien</button>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="2">Facile</button></div>`;
}

// ---------- Vues ----------
function vueReviser() {
	if (R.session) return vueSession();
	if (R.ouvert && R.chap[R.ouvert]) return vueChapitre(R.chap[R.ouvert]);
	const chs = Object.values(R.chap);
	if (!chs.length) return `<section class="carte"><h2>Révisions</h2><p class="vide">Aucun chapitre pour l'instant. Les contenus sont générés à partir de tes cours GoodNotes.</p></section>`;
	const dus = tousItems().filter((x) => (RECALL.includes(x.it.type) || EXOS.includes(x.it.type)) && estDu(x.k));
	const rendus = (S.data.revision.rendus || []).slice().sort((a, b) => b.date.localeCompare(a.date));
	const parUe = {};
	for (const ch of chs) (parUe[ch.ue] ||= []).push(ch);
	return `<div class="grille deux">
		<div class="grille">
			<div class="hero r-hero" data-r-session="dus">
				<div class="eti">Aujourd'hui</div>
				<div class="nom">${dus.length ? `${Math.min(25, dus.length)} à revoir aujourd'hui` : "Tout est à jour 🎉"}</div>
				<div class="info">${dus.length ? `Session de 25 max (${dus.length} en attente au total). Ce que tu oublies revient plus souvent.` : "Lance une session mélangée pour t'entraîner."}</div>
			</div>
			<div class="rang"><button class="bouton large" data-r-session="melange">🔀 Session mélangée</button><button class="bouton large" data-r-session="partiel">🎯 Prochain partiel</button></div>
			${rendus.length ? `<section class="carte"><h2>Mes rendus</h2>${rendus.slice(0, 5).map((r) => { const x = item(r.cle); return `<div class="ligne cliquable" data-r-ouvrir="${h(r.cle.split(":")[0])}"><div class="corps"><div class="t">${h(x?.it ? TYPES[x.it.type] + " · " + (x.ch.titre) : r.cle)}</div><div class="s">${r.statut === "en_attente" ? "⏳ En attente de validation" : r.statut === "valide" ? "✅ Validé" : "✏️ À retravailler"}${r.note != null ? ` · ${h(r.note)}/10` : ""}</div></div></div>`; }).join("")}</section>` : ""}
		</div>
		<div class="grille">${Object.entries(parUe).map(([ue, liste]) => `<section class="carte"><h2>${h(ue)} · ${h(ues().find((u) => u.code === ue)?.nom || "")}</h2>${liste.map((ch) => {
			const m = maitrise(ch), j = partielDe(ch);
			return `<div class="ligne barre cliquable" style="--c:${couleur(ch.ue)}" data-r-ouvrir="${h(ch.id)}"><div class="corps"><div class="t">${h(ch.titre)}</div>
				<div class="s">${h(ch.matiere || "")}${j != null ? ` · <span class="${j <= 14 ? "retard" : ""}">partiel J-${j}</span>` : ""}</div>
				<div class="r-barre"><span style="width:${m}%"></span></div></div><div class="petit">${m}%</div></div>`;
		}).join("")}</section>`).join("")}</div>
	</div>`;
}

function vueChapitre(ch) {
	const par = (t) => (ch.items || []).filter((it) => it.type === t);
	const bloc = (titre, liste, mode = "liste") => (liste.length ? `<h2 class="section-titre r-sec">${titre}</h2><div class="grille">${liste.map((it) => carteItem(ch, it, mode)).join("")}</div>` : "");
	const m = maitrise(ch), j = partielDe(ch);
	return `<button class="bouton petit-b" data-r-retour>‹ Révisions</button>
		<div class="carte r-entete" style="--c:${couleur(ch.ue)};margin-top:12px">
			<div class="petit">${h(ch.ue)}${ch.matiere ? " / " + h(ch.matiere) : ""}${j != null ? ` · partiel J-${j}` : ""}</div>
			<h3 style="font:700 22px var(--titre);margin:4px 0 8px">${h(ch.titre)}</h3>
			<div class="r-barre"><span style="width:${m}%"></span></div><div class="petit" style="margin-top:4px">Maîtrise ${m}%${(ch.sources || []).map((s) => s.url ? ` · <a href="${h(s.url)}" target="_blank" rel="noopener">${h(s.fichier)}</a>` : "").join("")}</div>
			<div class="r-actions" style="margin-top:12px">
				<button class="bouton plein" data-r-session="cartes:${h(ch.id)}">🃏 Cartes</button>
				<button class="bouton plein" data-r-session="exos:${h(ch.id)}">✍️ Exercices</button>
				<button class="bouton" data-r-session="tout:${h(ch.id)}">Tout le chapitre</button>
			</div>
		</div>
		${bloc("Fiche mémo", par("fiche"))}
		${bloc("Équations importantes", par("equation"))}
		${bloc("Définitions", par("definition"))}
		${bloc("Cartes", par("flash"), "session")}
		${bloc("QCM", par("qcm"))}
		${bloc("Textes à trous", par("trous"))}
		${bloc("Calculs", par("calcul"))}
		${bloc("Principes à expliquer", par("principe"))}
		${bloc("Résumé à faire", par("resume"))}
		${bloc("Vidage de mémoire", par("memoire"))}`;
}

function vueSession() {
	const s = R.session;
	if (s.i >= s.cles.length) {
		return `<div class="carte" style="text-align:center;padding:30px 20px"><div style="font-size:44px">🎉</div><h3 style="font:700 22px var(--titre)">Session terminée</h3>
			<p class="petit">${s.cles.length} élément${s.cles.length > 1 ? "s" : ""} travaillé${s.cles.length > 1 ? "s" : ""} · ${s.bons} réussi${s.bons > 1 ? "s" : ""}</p>
			<button class="bouton plein large" data-r-fin>Terminer</button></div>`;
	}
	const x = item(s.cles[s.i]);
	if (!x?.it) { s.i++; return vueSession(); }
	return `<div class="nav-semaine"><button class="bouton petit-b" data-r-fin>✕ Quitter</button><strong>${h(s.titre)}</strong><span class="petit">${s.i + 1}/${s.cles.length}</span></div>
		<div class="r-barre" style="margin:6px 0 14px"><span style="width:${Math.round((100 * s.i) / s.cles.length)}%"></span></div>
		<div class="petit" style="margin-bottom:6px">${h(x.ch.titre)}</div>
		${carteItem(x.ch, x.it, "session")}
		<div class="r-actions" style="margin-top:14px"><button class="bouton large ${s.repondu ? "plein" : ""}" data-r-suivant>${s.repondu ? "Suivant ›" : "Passer ›"}</button></div>`;
}

function demarrerSession(type) {
	const now = auj();
	let liste = [], titre = "";
	const melanger = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
	const travail = (x) => RECALL.includes(x.it.type) || EXOS.includes(x.it.type);
	if (type === "dus") {
		titre = "À revoir";
		liste = tousItems().filter((x) => travail(x) && estDu(x.k)).sort((a, b) => ((S.data.progres[a.k] || {}).boite || 0) - ((S.data.progres[b.k] || {}).boite || 0)).slice(0, 25);
		liste = melanger(liste);
	} else if (type === "melange") {
		titre = "Session mélangée";
		// Entraînement entrelacé : plusieurs chapitres, priorité aux partiels proches
		const poids = (x) => { const j = partielDe(x.ch); return (j != null ? 30 / (1 + j) : 0) + Math.random() * 2 + (EXOS.includes(x.it.type) ? 1 : 0); };
		liste = tousItems().filter(travail).sort((a, b) => poids(b) - poids(a)).slice(0, 12);
		liste = melanger(liste);
	} else if (type === "partiel") {
		const prochains = partielsTous().filter((p) => jourCle(p.debut) >= now && p.matiere);
		const ue = prochains.map((p) => p.matiere.split(" / ")[0]).find((u) => Object.values(R.chap).some((c) => c.ue === u));
		if (!ue) { alerteDouce("Aucun chapitre lié à tes prochains partiels pour l'instant."); return; }
		titre = `Partiel ${ue}`;
		liste = melanger(tousItems().filter((x) => x.ch.ue === ue && travail(x))).slice(0, 20);
	} else {
		const [mode, id] = type.split(":");
		const ch = R.chap[id];
		titre = mode === "cartes" ? "Cartes" : mode === "exos" ? "Exercices" : ch.titre;
		liste = (ch.items || []).map((it) => ({ ch, it, k: cle(ch.id, it.id) })).filter((x) => (mode === "cartes" ? RECALL.includes(x.it.type) : mode === "exos" ? EXOS.includes(x.it.type) : x.it.type !== "fiche"));
		if (mode === "cartes") liste = melanger(liste);
	}
	if (!liste.length) { alerteDouce("Rien à réviser ici pour l'instant."); return; }
	R.session = { titre, cles: liste.map((x) => x.k), i: 0, bons: 0, repondu: false };
	location.hash = "#reviser";
	rendre();
	window.scrollTo(0, 0);
}
function repondu(k, niveau) {
	noter(k, niveau);
	if (R.session && R.session.cles[R.session.i] === k) {
		R.session.repondu = true;
		if (niveau > 0) R.session.bons++;
		const b = document.querySelector("[data-r-suivant]");
		if (b) { b.classList.add("plein"); b.textContent = "Suivant ›"; }
	}
}

// ---------- Évènements ----------
document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-r-ouvrir],[data-r-retour],[data-r-session],[data-r-fin],[data-r-suivant],[data-r-montrer],[data-r-note],[data-r-qcm],[data-r-trous],[data-r-calcul],[data-r-solution],[data-r-indice],[data-r-comparer],[data-r-envoyer],[data-r-claude-txt],[data-r-chrono]");
	if (!el) return;
	const d = el.dataset;
	if (d.rOuvrir) { R.ouvert = d.rOuvrir; R.session = null; location.hash = "#reviser"; rendre(); window.scrollTo(0, 0); return; }
	if ("rRetour" in d) { R.ouvert = null; rendre(); return; }
	if (d.rSession) return demarrerSession(d.rSession);
	if ("rFin" in d) { R.session = null; rendre(); window.scrollTo(0, 0); return; }
	if ("rSuivant" in d) { R.session.i++; R.session.repondu = false; rendre(); window.scrollTo(0, 0); return; }
	const k = d.rMontrer || d.rNote || d.rQcm || d.rTrous || d.rCalcul || d.rSolution || d.rIndice || d.rComparer || d.rEnvoyer || d.rClaudeTxt || d.rChrono;
	const x = item(k);
	if (!x?.it) return;
	const { ch, it } = x;
	if (d.rMontrer) {
		$(`#v-${CSS.escape(k)}`).hidden = false; el.hidden = true;
		const n = $(`#n-${CSS.escape(k)}`); if (n) n.hidden = false;
		formules($(`#v-${CSS.escape(k)}`));
		return;
	}
	if (d.rNote) {
		repondu(k, Number(d.n));
		const n = $(`#n-${CSS.escape(k)}`); if (n) n.innerHTML = `<span class="petit">✓ Noté — ${["revient demain", "revient plus tard", "revient bien plus tard"][Number(d.n)]}</span>`;
		return;
	}
	if (d.rQcm) {
		const i = Number(d.i), bon = i === it.bonne;
		el.parentElement.querySelectorAll("button").forEach((b, j) => { b.disabled = true; if (j === it.bonne) b.classList.add("bon"); else if (j === i) b.classList.add("faux"); });
		$(`#r-${CSS.escape(k)}`).innerHTML = `<div class="r-msg ${bon ? "ok" : "ko"}">${bon ? "✓ Bonne réponse" : "✗ Ce n'est pas ça"}</div>${it.explication ? `<div class="r-md">${md(it.explication)}</div>` : ""}`;
		formules($(`#r-${CSS.escape(k)}`));
		repondu(k, bon ? 1 : 0);
		return;
	}
	if (d.rTrous || d.rSolution && it.type === "trous") {
		const champs = [...$(`#t-${CSS.escape(k)}`).querySelectorAll(".r-trou")];
		if (d.rSolution) { champs.forEach((c) => { c.value = c.dataset.rep.split("|")[0]; c.classList.add("montre"); }); return; }
		let bons = 0;
		champs.forEach((c) => { const ok = c.dataset.rep.split("|").some((r) => proche(norm(r), norm(c.value))); c.classList.toggle("bon", ok); c.classList.toggle("faux", !ok); if (ok) bons++; });
		$(`#r-${CSS.escape(k)}`).innerHTML = `<div class="r-msg ${bons === champs.length ? "ok" : "ko"}">${bons}/${champs.length} correct${bons > 1 ? "s" : ""}</div>`;
		if (!el.dataset.fait) { repondu(k, bons === champs.length ? 1 : 0); el.dataset.fait = "1"; }
		return;
	}
	if (d.rCalcul) {
		const v = nombre($(`#c-${CSS.escape(k)}`).value), att = Number(it.reponse.valeur), tol = it.reponse.tolerance ?? 0.02;
		if (v == null) { $(`#r-${CSS.escape(k)}`).innerHTML = `<div class="r-msg ko">Entre un nombre.</div>`; return; }
		const ok = att === 0 ? Math.abs(v) < 1e-9 : Math.abs(v - att) / Math.abs(att) <= tol;
		$(`#r-${CSS.escape(k)}`).innerHTML = `<div class="r-msg ${ok ? "ok" : "ko"}">${ok ? "✓ Juste !" : "✗ Pas tout à fait. Essaie un indice, ou ouvre la solution."}</div>`;
		if (!el.dataset.fait) { repondu(k, ok ? 1 : 0); el.dataset.fait = "1"; }
		return;
	}
	if (d.rSolution) { const s = $(`#s-${CSS.escape(k)}`); s.hidden = !s.hidden; formules(s); return; }
	if (d.rIndice) {
		const box = $(`#ind-${CSS.escape(k)}`);
		const n = box.children.length;
		if (n < it.indices.length) { box.insertAdjacentHTML("beforeend", `<div class="r-indice">💡 ${md(it.indices[n])}</div>`); formules(box); }
		if (n + 1 >= it.indices.length) { el.disabled = true; el.textContent = "Plus d'indice"; }
		return;
	}
	if (d.rComparer) {
		const v = $(`#v-${CSS.escape(k)}`);
		v.hidden = false;
		v.innerHTML = `<div class="section-titre" style="margin-top:12px">Points clés attendus — coche ceux que tu as mis</div>
			${(it.attendus || []).map((a, i) => `<label class="choix"><input type="checkbox" data-r-att="${h(k)}" value="${i}"><span>${inline(h(a))}</span></label>`).join("")}
			${it.modele ? `<details style="margin-top:10px"><summary class="petit">Voir une réponse modèle</summary><div class="r-md">${md(it.modele)}</div></details>` : ""}
			<button class="bouton plein large" style="margin-top:10px" data-r-score="${h(k)}">Enregistrer mon score</button>`;
		formules(v);
		return;
	}
	if (d.rEnvoyer) {
		const texte = ($(`#x-${CSS.escape(k)}`)?.value || "").trim();
		const photo = R.photos[k];
		if (texte.length < 20 && !photo) { alerteDouce("Écris un peu plus ou joins une photo avant d'envoyer."); return; }
		const r = { id: uid(), cle: k, type: it.type, texte, date: new Date().toISOString(), statut: "en_attente" };
		el.disabled = true; el.textContent = "Envoi…";
		(async () => {
			if (photo) { r.image = `revision/rendus/${r.id}.jpg`; await envoyerImage(r.image, photo, `Photo de rendu : ${ch.titre}`); }
			await modifier("revision/rendus.json", "rendus", (l) => [...l, r], `Rendu : ${TYPES[it.type]} · ${ch.titre}`, { sansSynchro: true, cible: "revision" });
		})()
			.then(() => {
				delete R.photos[k];
				const ap = $(`#p-${CSS.escape(k)}`); if (ap) ap.innerHTML = "";
				const carte = el.closest(".r-carte");
				carte.querySelectorAll(".r-statut").forEach((x) => x.remove());
				el.closest(".r-actions").insertAdjacentHTML("afterend", `<div class="r-statut en_attente">⏳ Envoyé${r.image ? " avec photo" : ""} · correction cette nuit</div>`);
				el.textContent = "Envoyé ✓";
			})
			.catch((err) => { el.disabled = false; el.textContent = "Réessayer"; alerteDouce(err.message); });
		return;
	}
	if (d.rClaudeTxt) {
		e.preventDefault();
		const texte = $(`#x-${CSS.escape(k)}`).value.trim();
		window.open(lienClaude(ch, it, texte), "_blank", "noopener");
		return;
	}
	if (d.rChrono) {
		clearInterval(R.chrono);
		let reste = 300;
		const aff = $(`#ch-${CSS.escape(k)}`);
		R.chrono = setInterval(() => { reste--; if (aff) aff.textContent = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, "0")}`; if (reste <= 0) { clearInterval(R.chrono); if (aff) aff.textContent = "⏰ Temps écoulé : compare !"; } }, 1000);
		return;
	}
});
document.addEventListener("change", async (e) => {
	const k = e.target.dataset?.rPhoto;
	if (!k || !e.target.files?.[0]) return;
	try {
		R.photos[k] = await compresserImage(e.target.files[0]);
		const ap = $(`#p-${CSS.escape(k)}`);
		if (ap) ap.innerHTML = `<img src="${R.photos[k]}" alt="Photo jointe"><button class="bouton petit-b" data-r-photo-suppr="${h(k)}">Retirer</button>`;
	} catch { alerteDouce("Impossible de lire cette image."); }
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-photo-suppr]");
	if (!b) return;
	delete R.photos[b.dataset.rPhotoSuppr];
	b.parentElement.innerHTML = "";
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-score]");
	if (!b) return;
	const k = b.dataset.rScore;
	const cases = [...document.querySelectorAll(`[data-r-att="${CSS.escape(k)}"]`)];
	const n = cases.filter((c) => c.checked).length, tot = cases.length || 1;
	repondu(k, n / tot >= 0.9 ? 2 : n / tot >= 0.6 ? 1 : 0);
	b.outerHTML = `<div class="r-msg ${n / tot >= 0.6 ? "ok" : "ko"}">${n}/${tot} points clés · ${n / tot >= 0.6 ? "bien joué" : "à retravailler, ça reviendra bientôt"}</div>`;
});
let brouillonTimer;
document.addEventListener("input", (e) => {
	const k = e.target.dataset?.rBrouillon;
	if (!k) return;
	R.brouillons[k] = e.target.value;
	clearTimeout(brouillonTimer);
	brouillonTimer = setTimeout(() => store.set("ae.brouillons", R.brouillons), 500);
});
