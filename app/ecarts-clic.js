"use strict";
// Rend cliquables les créneaux qui n'existent que sur le site Lise (écarts « ajout » ou « horaire »)
// et qui ne sont pas encore dans events.json : l'agenda les affiche, mais le clic cherchait uniquement
// dans events.json. On les ajoute en mémoire le temps du clic, puis on les retire.
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
})();
