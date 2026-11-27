"use strict";
// Écarts entre le lien iCal de Lise (base de l'appli) et le site Lise.
// - Chaque écart peut être appliqué ou ignoré ; le choix est écrit dans decisions.json (dépôt de données),
//   puis la synchro est relancée (relancerSynchro dans app.js) : scripts/sync.mjs applique les écarts acceptés
//   à events.json et au calendrier .ics.
// - L'agenda affiche deux demi-colonnes (Std = lien iCal, Lise = site) les jours concernés.
// - L'onglet « Écarts » est dessiné par ecarts-infos.js ; le choix de la bonne version par ecarts-choix.js.

(function () {
	const DEC0 = { appliques: [], ignores: [] };
	const style = document.createElement("style");
	style.textContent = `
:root{--ec-std:#2f6fb0;--ec-lise:#d9822b}
.accueil-haut .pastilles{display:flex;flex-wrap:nowrap;gap:6px;align-items:center;flex:none}
.accueil-haut .date-jour{min-width:0}
.pastille-ecarts{padding:6px 10px 6px 8px}
.ec-tete{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.ag-tete.split{border-left:1px solid var(--ligne,#ddd)}
.ec-sub{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-top:3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.ec-sub i{font-style:normal;color:#fff!important;border-radius:4px;padding:2px 0;text-align:center;font-size:8px;letter-spacing:0;overflow:hidden;text-overflow:clip;white-space:nowrap}
.ec-sub i:first-child{background:var(--ec-std)}
.ec-sub i:last-child{background:var(--ec-lise)}
.ag-col.ec-ics{background-color:color-mix(in srgb,var(--ec-std) 9%,transparent);border-left:2px solid var(--ec-std)}
.ag-col.ec-lise{background-color:color-mix(in srgb,var(--ec-lise) 11%,transparent);border-left:2px solid var(--ec-lise)}
.ag-col.ec-ics .ag-cours{box-shadow:inset 0 3px 0 var(--ec-std)}
.ag-col.ec-lise .ag-cours{box-shadow:inset 0 3px 0 var(--ec-lise)}
.ag-cours.ec-d{outline-offset:-2px}
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

	// Place des cours triés par début dans des « voies » côte à côte quand ils se chevauchent :
	// place[i] = voie du cours i ; groupes[i] = nombre de voies partagées avec lui (donne sa largeur).
	function placerEnVoies(evs) {
		const voies = [];
		const place = evs.map((e) => {
			let v = voies.findIndex((fin) => fin <= e.debut);
			if (v < 0) { v = voies.length; voies.push(e.fin); } else voies[v] = e.fin;
			return v;
		});
		const groupes = evs.map((e) => Math.max(1, ...evs.filter((x) => x.debut < e.fin && x.fin > e.debut).map((x) => place[evs.indexOf(x)] + 1)));
		return { place, groupes };
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
			return `<div class="ag-tete ${u.c === aujC ? "auj" : ""} ${u.split ? "split" : ""}" style="${u.split ? "grid-column:span 2" : ""}"><span>${h(fmt(d, { weekday: "short" }).replace(".", ""))}</span><b>${fmt(d, { day: "numeric" })}</b>${u.split ? '<div class="ec-sub"><i>Std</i><i>Lise</i></div>' : ""}</div>`;
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
			const { place, groupes } = placerEnVoies(evs);
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

	// « Tout appliquer / Tout ignorer » (data-ec-tout) est géré par ecarts-infos.js, qui exclut les cours suspects
	document.addEventListener("click", (e) => {
		const el = e.target.closest("[data-ec-app],[data-ec-ign]");
		if (!el) return;
		const d = el.dataset;
		if (d.ecApp) return decider([d.ecApp], "appliques", "Écart appliqué");
		if (d.ecIgn) return decider([d.ecIgn], "ignores", "Écart ignoré");
	});

	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chargerEcarts(); });
	window.addEventListener("online", chargerEcarts);
	setInterval(() => { if (document.visibilityState === "visible") chargerEcarts(); }, 5 * 60e3);
	rendre();
	chargerEcarts();
})();
