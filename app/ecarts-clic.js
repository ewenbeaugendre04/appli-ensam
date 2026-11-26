"use strict";
// Créneaux et partiels qui n'existent que sur le site Lise (écarts « ajout » ou « horaire » pas encore
// appliqués, donc absents d'events.json) :
//  1) les créneaux d'agenda correspondants deviennent cliquables (fiche du cours) ;
//  2) les évaluations ajoutées sur le site sont aussi listées dans les partiels.
(function () {
	const ecarts = () => (S.data.ecarts || {}).ecarts || [];

	// Cours du site (avant ou après) correspondant à cet uid, tel que décrit dans ecarts.json
	function coursDEcart(uid) {
		for (const e of ecarts()) {
			for (const x of [e.apres, e.avant]) if (x && x.uid === uid) return x;
		}
		return null;
	}

	// 1) Au clic sur un cours absent d'events.json, on l'ajoute en mémoire le temps que le gestionnaire de clic
	//    d'app.js (qui cherche dans events.json) ouvre sa fiche.
	document.addEventListener("click", (e) => {
		const el = e.target.closest("[data-cours],[data-tache-cours],[data-partiel-cours]");
		if (!el) return;
		const uid = el.dataset.cours || el.dataset.tacheCours || el.dataset.partielCours;
		const liste = S.data.events && S.data.events.events;
		if (!uid || !liste || liste.some((x) => x.uid === uid)) return;
		const cours = coursDEcart(uid);
		if (!cours) return;
		liste.push(cours);
		setTimeout(() => {
			const i = liste.indexOf(cours);
			if (i >= 0) liste.splice(i, 1);
		}, 0);
	}, true);

	// 2) Partiels : évaluations ajoutées sur le site Lise, pas encore dans events.json ni écartées
	const partielsOrig = window.partielsTous;
	if (typeof partielsOrig !== "function") return;
	window.partielsTous = function () {
		const base = partielsOrig();
		const connus = new Set(cours().map((x) => x.uid));
		const surcharges = (S.data.partiels || []).filter((p) => p.liseUid);
		const ignores = new Set((S.data.decisions || {}).ignores || []);
		const ajouts = [];
		for (const x of ecarts()) {
			const a = x.apres;
			if (x.type !== "ajout" || !a || !a.examen || connus.has(a.uid) || ignores.has(x.id)) continue;
			const ov = surcharges.find((p) => p.liseUid === a.uid) || {};
			ajouts.push({
				id: "lise-" + a.uid, liseUid: a.uid, titre: ov.titre || a.titre, debut: a.debut, fin: a.fin, salle: a.salle,
				matiere: ov.matiere || matiereDe(a), type: a.type, description: ov.description || "", chapitres: ov.chapitres || null,
				surchargeId: ov.id || "", source: "Lise",
			});
		}
		return ajouts.length ? [...base, ...ajouts].sort((p, q) => p.debut.localeCompare(q.debut)) : base;
	};
})();
