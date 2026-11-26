"use strict";
// Rend cliquables les créneaux qui n'existent que sur le site Lise (écarts « ajout » ou « horaire »)
// et qui ne sont pas encore dans events.json : l'agenda les affiche, mais le clic cherchait uniquement
// dans events.json. On les ajoute en mémoire le temps du clic, puis on les retire.
// Les évaluations (examen) ajoutées sur le site sont aussi listées dans les partiels.
(function () {
	const SEL = "[data-cours],[data-tache-cours],[data-partiel-cours]";
	function chercher(uid) {
		for (const e of ((S.data.ecarts || {}).ecarts || [])) {
			for (const x of [e.apres, e.avant]) if (x && x.uid === uid) return x;
		}
		return null;
	}
	document.addEventListener("click", (e) => {
		const el = e.target.closest(SEL);
		if (!el) return;
		const uid = el.dataset.cours || el.dataset.tacheCours || el.dataset.partielCours;
		if (!uid) return;
		const liste = S.data.events && S.data.events.events;
		if (!liste || liste.some((x) => x.uid === uid)) return;
		const ev = chercher(uid);
		if (!ev) return;
		liste.push(ev);
		setTimeout(() => {
			const i = liste.indexOf(ev);
			if (i >= 0) liste.splice(i, 1);
		}, 0);
	}, true);

	// Partiels : évaluations ajoutées sur le site Lise, pas encore dans events.json
	const partielsOrig = window.partielsTous;
	if (typeof partielsOrig === "function") {
		window.partielsTous = function () {
			const base = partielsOrig();
			const connus = new Set(cours().map((x) => x.uid));
			const surcharges = (S.data.partiels || []).filter((p) => p.liseUid);
			const decides = new Set(((S.data.decisions || {}).ignores) || []);
			const sup = [];
			for (const x of ((S.data.ecarts || {}).ecarts || [])) {
				const a = x.apres;
				if (x.type !== "ajout" || !a || !a.examen || connus.has(a.uid) || decides.has(x.id)) continue;
				const ov = surcharges.find((p) => p.liseUid === a.uid) || {};
				sup.push({ id: "lise-" + a.uid, liseUid: a.uid, titre: ov.titre || a.titre, debut: a.debut, fin: a.fin, salle: a.salle, matiere: ov.matiere || matiereDe(a), type: a.type, description: ov.description || "", chapitres: ov.chapitres || null, surchargeId: ov.id || "", source: "Lise" });
			}
			return sup.length ? [...base, ...sup].sort((p, q) => p.debut.localeCompare(q.debut)) : base;
		};
	}
})();
