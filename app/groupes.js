"use strict";
// Curseur « Groupe 2 (moi) / Groupe 1 » dans l'Agenda et les Écarts.
// - Ton emploi du temps est toujours affiché en premier, et c'est lui qui s'ouvre à chaque lancement.
// - Groupe 1 : données de groupes/g1/ (events.json, ecarts.json) écrites par la synchro (scripts/sync.mjs).
//   L'agenda montre son lien iCal, avec les colonnes Std / Lise les jours où le site Lise diffère ;
//   les Écarts montrent la même comparaison, en lecture seule (rien n'est à trancher pour lui).
// - Technique : pendant le dessin d'une vue (et pendant un clic, pour ouvrir la fiche d'un cours),
//   les données du groupe 1 remplacent un instant les tiennes dans S.data, puis tout est remis en place.
(function () {
	const VUES_G = ["agenda", "ecarts"];
	let vue = "moi"; // pas gardé entre deux ouvertures : ton calendrier d'abord
	let g1 = null, chargement = null, echec = "";

	const style = document.createElement("style");
	style.textContent = `
.grp-seg{margin-bottom:12px}
.grp-seg button small{display:block;font-size:10px;font-weight:400;opacity:.7}
.vue-g1 > section.carte > p.petit,.vue-g1 .ec-actions,.vue-g1 .ec-tete,.vue-g1 [data-ec-tout]{display:none!important}
body.mode-g1 #feuille :is([data-tache-pour],[data-tache-cours],[data-partiel-cours]){display:none!important}
.grp-note{font-size:12px;color:var(--texte-2,#777);margin:-4px 0 12px}
`;
	document.head.appendChild(style);

	const groupe1 = () => ((S.data.config || {}).groupes || []).find((g) => g.id === "g1");

	async function chargerG1(force) {
		if (!S.token || !groupe1()) return;
		if (chargement && !force) return chargement;
		chargement = (async () => {
			try {
				const [ev, ec, st] = await Promise.all([
					lire("groupes/g1/events.json", null),
					lire("groupes/g1/ecarts.json", { ecarts: [] }).catch(() => ({ ecarts: [] })),
					lire("groupes/g1/etat-site.json", null).catch(() => null),
				]);
				g1 = ev ? { ev, ec, st } : null;
				echec = ev ? "" : "La synchro n'a pas encore récupéré son emploi du temps (quelques minutes après l'enregistrement du numéro).";
			} catch (e) { echec = "Lecture impossible : " + e.message; }
			if (vue === "g1" && VUES_G.includes(S.vue)) rendre();
		})();
		await chargement;
		chargement = null;
	}

	// Données du groupe 1 au format de S.data (base = lien iCal seul : les écarts du site s'affichent en colonne Lise)
	function donneesG1() {
		return {
			events: { majLe: g1.ev.majLe, etat: g1.ev.etat, events: g1.ev.base?.length ? g1.ev.base : g1.ev.events || [] },
			ecarts: g1.ec || { ecarts: [] },
			decisions: { appliques: [], ignores: [] },
			choix: { effectifs: [], versions: {} },
			tasks: [], partiels: [], detailsLise: [],
		};
	}
	let echange = null;
	function entrer() {
		if (echange || vue !== "g1" || !g1) return false;
		const d = donneesG1();
		echange = Object.fromEntries(Object.keys(d).map((k) => [k, S.data[k]]));
		Object.assign(S.data, d);
		return true;
	}
	function sortir() { if (echange) { Object.assign(S.data, echange); echange = null; } }

	function curseur() {
		const g = groupe1();
		return `<div class="segments grp-seg" role="tablist" aria-label="Emploi du temps affiché">
			<button role="tab" data-grp="moi" class="${vue === "moi" ? "actif" : ""}" aria-selected="${vue === "moi"}">Groupe 2<small>moi</small></button>
			<button role="tab" data-grp="g1" class="${vue === "g1" ? "actif" : ""}" aria-selected="${vue === "g1"}">Groupe 1<small>${h(g ? g.nom && g.nom !== "groupe 1" ? g.nom : "camarade" : "à configurer")}</small></button></div>`;
	}
	function ecranG1Absent() {
		if (!groupe1()) return `<section class="carte"><h2>Groupe 1</h2><p>Aucun camarade du groupe 1 n'est enregistré.</p>
			<p class="petit">Va dans Réglages → « Calendrier du groupe 1 » et entre son numéro étudiant. Son emploi du temps apparaît ici après la synchro suivante (quelques minutes).</p>
			<a class="bouton plein" href="#reglages" style="display:inline-block;text-decoration:none">Ouvrir les Réglages</a></section>`;
		if (echec) return `<section class="carte"><p class="vide">${h(echec)}</p></section>`;
		chargerG1();
		return `<section class="carte"><p class="vide">Chargement de l'emploi du temps du groupe 1…</p></section>`;
	}
	function noteG1(v) {
		const st = g1.st, maj = g1.ev.majLe;
		const site = st ? (st.ok ? "site Lise lu" : "site Lise non lu : seul son lien iCal est utilisé") : "site Lise pas encore lu";
		const n = ((g1.ec || {}).ecarts || []).length;
		if (v === "agenda") return `<p class="grp-note">Emploi du temps du groupe 1 · ${h(site)}${n ? ` · ${n} écart${n > 1 ? "s" : ""} avec le site (colonnes Std / Lise)` : ""}${maj ? ` · synchro ${h(fmt(maj, { weekday: "short", hour: "2-digit", minute: "2-digit" }))}` : ""}.</p>`;
		return `<p class="grp-note">Comparaison lien iCal / site Lise pour le groupe 1, en lecture seule : son calendrier partagé prend automatiquement la version du site · ${h(site)}.</p>`;
	}

	for (const v of VUES_G) {
		const orig = VUES[v];
		VUES[v] = function () {
			document.body.classList.toggle("mode-g1", vue === "g1");
			if (vue !== "g1") return curseur() + orig();
			if (!g1) return curseur() + ecranG1Absent();
			entrer();
			try { return `${curseur()}${noteG1(v)}<div class="vue-g1">${orig()}</div>`; } finally { sortir(); }
		};
	}

	// Pendant un clic (fiche d'un cours…) : données du groupe 1, remises en place juste après
	const bloque = "[data-ec-app],[data-ec-ign],[data-ec-tout],[data-effectif],[data-version],[data-tache-pour],[data-tache-cours],[data-partiel-cours]";
	for (const type of ["click", "change"]) {
		window.addEventListener(type, (e) => {
			if (vue !== "g1" || !VUES_G.includes(S.vue)) return;
			const t = e.target.closest && e.target.closest(bloque);
			if (t && g1) {
				e.stopImmediatePropagation(); e.preventDefault();
				bandeau("Emploi du temps du groupe 1 : consultation seulement.");
				return;
			}
			if (entrer()) setTimeout(sortir, 0);
		}, true);
	}

	document.addEventListener("click", (e) => {
		const b = e.target.closest("[data-grp]");
		if (!b) return;
		vue = b.dataset.grp;
		if (vue === "g1") chargerG1(true);
		rendre();
	});
	window.addEventListener("hashchange", () => { if (!VUES_G.includes((location.hash.slice(1) || "accueil"))) document.body.classList.remove("mode-g1"); });
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && vue === "g1") chargerG1(true); });
	rendre();
})();
