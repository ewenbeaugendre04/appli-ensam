"use strict";
// 1) Rend cliquables les créneaux qui n'existent que sur le site Lise (écarts « ajout » ou « horaire »)
//    et qui ne sont pas encore dans events.json : on les ajoute en mémoire le temps du clic.
// 2) Les évaluations (examen) ajoutées sur le site sont aussi listées dans les partiels.
// 3) Débat = un cours du lien iCal et un cours du site (uid « web-… ») qui se chevauchent dans events.json.
//    On coche alors le cours effectif (fiche du cours) ; seuls les cours cochés ou sans débat comptent
//    dans la liste de l'accueil et le total d'heures. Le choix est gardé dans choix.json (dépôt de données).
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
				sup.push({ id: "lise-" + a.uid, liseUid: a.uid, titre: ov.titre || a.titre, debut: a.debut, fin: a.fin, salle: a.salle, matiere: ov.matiere || matiereDe(a), type: a.type, description: ov.description || "", chapitres: ov.chapitres || null, surchargeId: ov.id || "", source: "Lise" };
			}
			return sup.length ? [...base, ...sup].sort((p, q) => p.debut.localeCompare(q.debut)) : base;
		};
	}

	// ---------- Cours effectif en cas de débat ----------
	const CHOIX0 = { effectifs: [] };
	const estWeb = (e) => String(e.uid).startsWith("web-");
	const choisis = () => new Set(((S.data.choix || CHOIX0).effectifs) || []);

	// Groupes de cours qui se chevauchent et mélangent iCal et site
	function debats(liste) {
		const evs = (liste || []).filter((e) => !e.journee).slice().sort((a, b) => a.debut.localeCompare(b.debut));
		const groupes = [];
		let cur = null, fin = "";
		for (const e of evs) {
			if (cur && e.debut < fin) { cur.push(e); if (e.fin > fin) fin = e.fin; }
			else { cur = [e]; groupes.push(cur); fin = e.fin; }
		}
		return groupes.filter((g) => g.length > 1 && g.some(estWeb) && g.some((e) => !estWeb(e)));
	}
	const enDebat = (uid) => debats(S.data.events && S.data.events.events).find((g) => g.some((e) => e.uid === uid)) || null;
	function effectifs(liste) {
		const sel = choisis();
		const exclus = new Set();
		for (const g of debats(liste)) for (const e of g) if (!sel.has(e.uid)) exclus.add(e.uid);
		return (liste || []).filter((e) => !exclus.has(e.uid));
	}

	const style = document.createElement("style");
	style.textContent = `
.ag-cours.deb-non{opacity:.45;outline:2px dashed #b3261e;outline-offset:-2px}
.ag-cours.deb-oui{outline:2px solid #1c6b2f;outline-offset:-2px}
.effectif{margin-top:12px;border-radius:12px;background:rgba(255,200,0,.22);padding:10px 12px}
.effectif label{display:flex;gap:10px;align-items:center;font-weight:600}
.effectif .petit{margin-top:4px}
`;
	document.head.appendChild(style);

	// Total d'heures de la semaine : uniquement les cours effectifs
	const avOrig = window.avancementSemaine;
	if (typeof avOrig === "function") {
		window.avancementSemaine = function (debutSem, finSem, parJour, tachesJour) {
			const ok = new Set(effectifs(Object.values(parJour).flat()).map((e) => e.uid));
			const filtre = {};
			for (const [c, evs] of Object.entries(parJour)) filtre[c] = evs.filter((e) => ok.has(e.uid));
			return avOrig(debutSem, finSem, filtre, tachesJour);
		};
	}

	// Agenda : cours en débat marqués (vert = effectif, rouge pointillé = non retenu)
	const grilleOrig = window.grilleSemaine;
	if (typeof grilleOrig === "function") {
		window.grilleSemaine = function (...args) {
			const html = grilleOrig.apply(this, args);
			const sel = choisis();
			const marque = new Map();
			for (const g of debats(S.data.events && S.data.events.events)) for (const e of g) marque.set(String(e.uid), sel.has(e.uid) ? "deb-oui" : "deb-non");
			if (!marque.size) return html;
			return html.replace(/<button class="ag-cours ([^"]*)"([^>]*?)data-cours="([^"]*)"/g, (m, cls, mid, u) => marque.has(u) ? `<button class="ag-cours ${cls} ${marque.get(u)}"${mid}data-cours="${u}"` : m);
		};
	}

	// Accueil : seulement les cours cochés ou sans débat
	const accueilOrig = VUES.accueil;
	VUES.accueil = function () {
		const ev = S.data.events;
		if (!ev || !ev.events || !debats(ev.events).length) return accueilOrig.apply(this, arguments);
		const original = S.data.events;
		S.data.events = { ...original, events: effectifs(original.events) };
		try { return accueilOrig.apply(this, arguments); } finally { S.data.events = original; }
	};

	// Fiche du cours : case « cours effectif » seulement quand il y a débat
	const detailOrig = window.detailCours;
	if (typeof detailOrig === "function") {
		window.detailCours = function (e) {
			detailOrig.apply(this, arguments);
			const g = enDebat(e.uid);
			const corps = document.getElementById("feuille-corps");
			if (!g || !corps) return;
			const autres = g.filter((x) => x.uid !== e.uid).map((x) => `${x.titre} (${estWeb(x) ? "site Lise" : "lien iCal"}) ${heure(x.debut)}–${heure(x.fin)}`).join(" ; ");
			const bloc = document.createElement("div");
			bloc.className = "effectif";
			bloc.innerHTML = `<label><input type="checkbox" class="coche" data-effectif="${h(e.uid)}" ${choisis().has(e.uid) ? "checked" : ""}> Cours effectif</label>
				<div class="petit">Ce créneau chevauche ${h(autres)}. Coche celui qui a vraiment lieu : lui seul compte dans le total d'heures et l'accueil.</div>`;
			const actions = corps.querySelector(".actions");
			if (actions) actions.before(bloc); else corps.appendChild(bloc);
		};
	}

	function basculer(uid, coche) {
		const g = enDebat(uid);
		const ids = g ? g.map((x) => x.uid) : [uid];
		return action(() => modifier("choix.json", "choix", (d) => {
			let eff = (d.effectifs || []).filter((x) => !ids.includes(x));
			if (coche) eff.push(uid);
			return { effectifs: eff };
		}, "Cours effectif", { defaut: CHOIX0, sansSynchro: true }));
	}
	document.addEventListener("change", (e) => {
		const el = e.target.closest && e.target.closest("[data-effectif]");
		if (!el) return;
		basculer(el.dataset.effectif, el.checked).then(() => { fermerFeuille(); rendre(); }).catch(() => {});
	});

	async function chargerChoix() {
		if (!S.token) return;
		try {
			S.data.choix = await lire("choix.json", CHOIX0);
			sauverCache();
			if (S.vue === "accueil" || S.vue === "agenda") rendre();
		} catch {}
	}
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chargerChoix(); });
	window.addEventListener("online", chargerChoix);
	chargerChoix();
})();
