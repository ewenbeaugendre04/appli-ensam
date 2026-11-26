"use strict";
// Onglet « Écarts » : différences entre le lien iCal de Lise et le site Lise.
// Chaque écart peut être appliqué ou ignoré ; le choix est écrit dans decisions.json (dépôt de données),
// puis la synchro est relancée (voir relancerSynchro dans app.js) : scripts/sync.mjs applique les écarts acceptés
// à events.json et au calendrier .ics. L'agenda affiche deux colonnes (ICS / Lise) les jours concernés.

(function () {
	const DEC0 = { appliques: [], ignores: [] };
	const style = document.createElement("style");
	style.textContent = `
.accueil-haut .pastilles{display:flex;flex-wrap:nowrap;gap:6px;align-items:center;flex:none}
.accueil-haut .date-jour{min-width:0}
.pastille-ecarts{padding:6px 10px 6px 8px}
.ecart{padding:12px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.ecart:last-child{border-bottom:0}
.ecart .ec-type{display:inline-block;font-size:12px;font-weight:700;border-radius:6px;padding:2px 7px;margin-bottom:4px;background:#eee}
.ecart .ec-ajout{background:#dff3e3;color:#1c6b2f}
.ecart .ec-horaire{background:#fff0d6;color:#8a5a00}
.ecart .ec-suppression{background:#fbe0e0;color:#9b1c1c}
.ecart .ec-actions{display:flex;gap:8px;margin-top:8px}
.ec-tete{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.ec-diff{margin-top:6px;border-radius:12px;background:var(--fond-2,#eee);padding:8px 10px;font-size:14px;display:grid;gap:6px}
.ec-l{display:grid;grid-template-columns:70px 1fr;gap:8px;align-items:baseline}
.ec-l>span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--doux,#777)}
.ec-l.vide>div{color:var(--doux,#777);font-style:italic}
.ec-ch{background:rgba(255,200,0,.35);border-radius:4px;padding:0 3px;font-weight:600}
.ec-sub{display:grid;grid-template-columns:1fr 1fr;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.ec-sub i{font-style:normal;color:var(--doux,#777)}
.ec-sub i:last-child{color:var(--accent,#8a1c2c)}
.ag-tete.split{border-left:1px solid var(--ligne,#ddd)}
.ag-col.ec-lise{background-color:color-mix(in srgb,var(--accent,#8a1c2c) 6%,transparent)}
.ag-col.ec-ics{border-left:1px solid var(--ligne,#ddd)}
.ag-col.ec-ics + .ag-col.ec-lise{border-left:1px dashed var(--ligne,#ccc)}
.ag-cours.ec-d{outline:2px dashed #d99a00;outline-offset:-2px}
.ag-semaine.avec-ecarts .ag-cours{font-size:9.5px}
`;
	document.head.appendChild(style);

	const debutEcart = (e) => (e.apres || e.avant || {}).debut || "";
	function enAttente() {
		const d = S.data.decisions || DEC0;
		const decides = new Set([...(d.appliques || []), ...(d.ignores || [])]);
		const debutJour = auj();
		return ((S.data.ecarts || {}).ecarts || []).filter((e) => !decides.has(e.id) && (!debutEcart(e) || jourCle(debutEcart(e)) >= debutJour));
	}
	const LIBELLE = { ajout: "Ajout", horaire: "Horaire", suppression: "Absent du site" };

	// Lignes « lien iCal » et « site » d'un écart, avec les champs différents mis en évidence
	function diff(e) {
		const champs = (c) => c ? {
			jour: fmt(c.debut, { weekday: "short", day: "numeric", month: "numeric" }),
			horaire: c.journee ? "journée" : `${heure(c.debut)}–${heure(c.fin)}`,
			titre: `${c.titre || c.module || "—"}${c.type ? ` (${c.type})` : ""}`,
			salle: c.salle || "—",
		} : null;
		const a = champs(e.avant), b = champs(e.apres);
		const ligne = (nom, f, autre) => {
			if (!f) return `<div class="ec-l vide"><span>${nom}</span><div>absent</div></div>`;
			const v = (k) => { const t = h(f[k]); return autre && autre[k] !== f[k] ? `<span class="ec-ch">${t}</span>` : t; };
			return `<div class="ec-l"><span>${nom}</span><div>${v("jour")} · ${v("horaire")} · ${v("titre")} · ${v("salle")}</div></div>`;
		};
		const both = a && b;
		return `<div class="ec-diff">${ligne("Lien iCal", a, both ? b : null)}${ligne("Site Lise", b, both ? a : null)}</div>`;
	}

	async function chargerEcarts() {
		if (!S.token) return;
		try {
			const [ecarts, decisions] = await Promise.all([lire("ecarts.json", { ecarts: [] }), lire("decisions.json", DEC0)]);
			S.data.ecarts = ecarts;
			S.data.decisions = decisions;
			sauverCache();
			if (S.vue === "accueil" || S.vue === "ecarts" || S.vue === "agenda") rendre();
		} catch {}
	}

	function decider(ids, cle, message) {
		return action(() => modifier("decisions.json", "decisions", (d) => {
			d = { appliques: d.appliques || [], ignores: d.ignores || [] };
			for (const id of ids) {
				if (!d[cle].includes(id)) d[cle].push(id);
				const autre = cle === "appliques" ? "ignores" : "appliques";
				d[autre] = d[autre].filter((x) => x !== id);
			}
			return d;
		}, message, { defaut: DEC0 }));
	}

	TITRES.ecarts = "Écarts";
	VUES.ecarts = function () {
		const liste = enAttente();
		const maj = (S.data.ecarts || {}).majLe;
		const carte = (e) => `<div class="ecart"><span class="ec-type ec-${h(e.type)}">${h(LIBELLE[e.type] || e.type)}</span>
			${diff(e)}
			<div class="ec-actions"><button class="bouton plein petit-b" data-ec-app="${h(e.id)}">Appliquer</button><button class="bouton petit-b" data-ec-ign="${h(e.id)}">Ignorer</button></div></div>`;
		return `<section class="carte"><h2>Planning : lien Lise ≠ site Lise</h2>
			<p class="petit">Le site Lise est en général plus à jour que le lien iCal (surtout pour les partiels). Rien n'est modifié sans ton accord. Un écart appliqué est ajouté à ton calendrier à la prochaine synchro (1 à 2 minutes).${maj ? ` Vérifié ${h(fmt(maj, { weekday: "short", hour: "2-digit", minute: "2-digit" }))}.` : ""}</p>
			${liste.length ? `<div class="ec-tete"><button class="bouton plein petit-b" data-ec-tout="app">Tout appliquer (${liste.length})</button><button class="bouton petit-b" data-ec-tout="ign">Tout ignorer</button></div>${liste.map(carte).join("")}` : '<p class="vide">Aucun écart à traiter.</p>'}</section>`;
	};

	const accueilOrig = VUES.accueil;
	VUES.accueil = function () {
		const html = accueilOrig();
		const n = enAttente().length;
		const pastille = `<a href="#ecarts" class="pastille-notes pastille-ecarts" aria-label="Écarts de planning${n ? ` (${n})` : ""}"><svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>Écarts${n ? `<b>${n}</b>` : ""}</a>`;
		return html.replace(/<a href="#notes"[\s\S]*?<\/a>/, (m) => `<span class="pastilles">${pastille}${m}</span>`);
	};

	// ---------- Agenda : deux colonnes (ICS / Lise) les jours concernés par un écart ----------
	function joursAvecEcarts() {
		const s = new Set(), a = auj();
		for (const e of (S.data.ecarts || {}).ecarts || []) {
			for (const x of [e.avant, e.apres]) if (x && jourCle(x.debut) >= a) s.add(jourCle(x.debut));
		}
		return s;
	}
	// ics : planning du lien iCal (écarts acceptés retirés) ; lise : le même avec tous les écarts du site
	function versionsJour(c, evs) {
		const appl = new Set((S.data.decisions || DEC0).appliques || []);
		const ecs = ((S.data.ecarts || {}).ecarts || []).filter((e) => [e.avant, e.apres].some((x) => x && jourCle(x.debut) === c));
		const remplace = (liste, x, nouveau) => {
			const r = liste.filter((e) => e.uid !== x.avant.uid);
			if (nouveau && jourCle(nouveau.debut) === c) r.push(nouveau);
			return r;
		};
		let ics = evs.slice();
		for (const x of ecs.filter((x) => appl.has(x.id))) {
			if (x.type === "ajout") ics = ics.filter((e) => e.uid !== x.apres.uid);
			else if (x.type === "suppression") { if (!ics.some((e) => e.uid === x.avant.uid)) ics.push(x.avant); }
			else ics = remplace(ics, x, x.avant);
		}
		let lise = ics.slice();
		for (const x of ecs) {
			if (x.type === "ajout") { if (!lise.some((e) => e.uid === x.apres.uid)) lise.push(x.apres); }
			else if (x.type === "suppression") lise = lise.filter((e) => e.uid !== x.avant.uid);
			else lise = remplace(lise, x, x.apres);
		}
		return { ics, lise };
	}

	window.grilleSemaine = function (debutSem, parJour, tachesJour) {
		const aujC = auj();
		const separes = joursAvecEcarts();
		const jours = [];
		for (let i = 0; i < 7; i++) {
			const c = ajouterJours(debutSem, i);
			if (i < 5 || (parJour[c] || []).length || (tachesJour[c] || []).length) jours.push(c);
		}
		// Un « jour » = une ou deux colonnes
		const unites = jours.map((c) => {
			if (!separes.has(c)) return { c, cols: [{ cote: "", evs: parJour[c] || [] }] };
			const v = versionsJour(c, parJour[c] || []);
			const cle = (e) => `${e.uid}|${e.debut}|${e.fin}|${e.salle || ""}`;
			const kI = new Set(v.ics.map(cle)), kL = new Set(v.lise.map(cle));
			return { c, split: true, cols: [
				{ cote: "ics", evs: v.ics, diff: (e) => !kL.has(cle(e)) },
				{ cote: "lise", evs: v.lise, diff: (e) => !kI.has(cle(e)) },
			] };
		});
		const nCols = unites.reduce((n, u) => n + u.cols.length, 0);
		let hMin = 8 * 60, hMax = 18 * 60;
		for (const u of unites) for (const col of u.cols) for (const e of col.evs) if (!e.journee) { hMin = Math.min(hMin, minutesParis(e.debut)); hMax = Math.max(hMax, minutesParis(e.fin) || 24 * 60); }
		const h0 = Math.floor(hMin / 60), h1 = Math.min(24, Math.ceil(hMax / 60));
		const PX = 46;
		const hauteur = (h1 - h0) * PX;
		const y = (min) => ((min - h0 * 60) / 60) * PX;
		const now = Date.now();
		const minNow = minutesParis(new Date().toISOString());
		const tete = unites.map((u) => {
			const d = new Date(u.c + "T12:00:00Z");
			return `<div class="ag-tete ${u.c === aujC ? "auj" : ""} ${u.split ? "split" : ""}" style="${u.split ? "grid-column:span 2" : ""}"><span>${h(fmt(d, { weekday: "short" }).replace(".", ""))}</span><b>${fmt(d, { day: "numeric" })}</b>${u.split ? '<div class="ec-sub"><i>ICS</i><i>Lise</i></div>' : ""}</div>`;
		}).join("");
		const haut = unites.map((u) => {
			const source = u.split ? u.cols[1].evs : u.cols[0].evs;
			const jr = source.filter((e) => e.journee);
			const ts = tachesJour[u.c] || [];
			return `<div class="ag-jr" style="${u.split ? "grid-column:span 2" : ""}">${jr.map((e) => `<button class="ag-puce" style="--c:${couleur(matiereDe(e))}" data-cours="${h(e.uid)}">${h(e.titre)}</button>`).join("")}${ts.map((t) => `<button class="ag-puce tache ${t.fait ? "fait" : ""}" style="--c:${couleur(t.matiere)}" data-tache="${h(t.id)}">${t.fait ? "✓" : "☐"} ${h(t.titre)}</button>`).join("")}</div>`;
		}).join("");
		const aHaut = unites.some((u) => u.cols.some((col) => col.evs.some((e) => e.journee)) || (tachesJour[u.c] || []).length);
		const colonne = (u, col) => {
			const c = u.c;
			const evs = col.evs.filter((e) => !e.journee).sort((a, b) => a.debut.localeCompare(b.debut));
			const voies = [];
			const place = evs.map((e) => { let v = voies.findIndex((fin) => fin <= e.debut); if (v < 0) { v = voies.length; voies.push(e.fin); } else voies[v] = e.fin; return v; });
			const groupes = evs.map((e) => Math.max(1, ...evs.filter((x) => x.debut < e.fin && x.fin > e.debut).map((x) => place[evs.indexOf(x)] + 1)));
			const blocs = evs.map((e, i) => {
				const top = y(minutesParis(e.debut)), haut = Math.max(18, y(minutesParis(e.fin) || 24 * 60) - top);
				const d = Date.parse(e.debut), f = Date.parse(e.fin);
				const etat = now >= f ? "passe" : now > d ? "encours" : "";
				const pc = etat === "encours" ? Math.round((100 * (now - d)) / (f - d)) : 0;
				const larg = 100 / groupes[i];
				const dif = col.diff && col.diff(e) ? "ec-d" : "";
				return `<button class="ag-cours ${etat} ${e.examen ? "examen" : ""} ${dif}" style="--c:${couleur(matiereDe(e))};top:${top}px;height:${haut}px;left:${place[i] * larg}%;width:calc(${larg}% - 2px)" data-cours="${h(e.uid)}" title="${h(e.titre)}">
					${etat === "encours" ? `<span class="ag-fil" style="height:${pc}%"></span>` : ""}
					${haut < 34 ? `<span class="ag-t ag-court"><b>${heure(e.debut)}</b> ${h(e.titre.replace(/ - (Enseignement|Projet)$/, ""))}</span>` : `<span class="ag-h">${heure(e.debut)}${e.examen ? " · Exam" : e.type ? " · " + h(e.type) : ""}</span>
					<span class="ag-t">${h(e.titre.replace(/ - (Enseignement|Projet)$/, ""))}</span>`}
					${haut > 56 && e.salle ? `<span class="ag-s">${h(salle(e.salle))}</span>` : ""}</button>`;
			}).join("");
			const ligneNow = c === aujC && minNow >= h0 * 60 && minNow <= h1 * 60 ? `<div class="ag-now" style="top:${y(minNow)}px"></div>` : "";
			return `<div class="ag-col ${c === aujC ? "auj" : ""} ${c < aujC ? "passe" : ""} ${col.cote ? "ec-" + col.cote : ""}" style="height:${hauteur}px">${blocs}${ligneNow}</div>`;
		};
		const colonnes = unites.map((u) => u.cols.map((col) => colonne(u, col)).join("")).join("");
		const heures = Array.from({ length: h1 - h0 }, (_, i) => `<div class="ag-heure" style="top:${i * PX}px">${h0 + i}h</div>`).join("");
		return `<div class="ag-semaine ${separes.size && unites.some((u) => u.split) ? "avec-ecarts" : ""}" style="--n:${nCols};--px:${PX}px">
		<div class="ag-ligne-tete"><div></div>${tete}</div>
		${aHaut ? `<div class="ag-ligne-haut"><div class="ag-heure-vide"></div>${haut}</div>` : ""}
		<div class="ag-corps"><div class="ag-heures" style="height:${hauteur}px">${heures}</div>${colonnes}</div>
	</div>
	${Object.values(parJour).flat().length || unites.some((u) => u.split) ? "" : '<p class="vide" style="margin-top:14px">Aucun cours cette semaine.</p>'}`;
	};

	document.addEventListener("click", (e) => {
		const el = e.target.closest("[data-ec-app],[data-ec-ign],[data-ec-tout]");
		if (!el) return;
		const d = el.dataset;
		if (d.ecApp) return decider([d.ecApp], "appliques", "Écart appliqué");
		if (d.ecIgn) return decider([d.ecIgn], "ignores", "Écart ignoré");
		const ids = enAttente().map((x) => x.id);
		if (d.ecTout === "app") return decider(ids, "appliques", "Écarts appliqués");
		if (d.ecTout === "ign") return decider(ids, "ignores", "Écarts ignorés");
	});

	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chargerEcarts(); });
	window.addEventListener("online", chargerEcarts);
	setInterval(() => { if (document.visibilityState === "visible") chargerEcarts(); }, 5 * 60e3);
	rendre();
	chargerEcarts();
})();
