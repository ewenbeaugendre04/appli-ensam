"use strict";
// 1) Rend cliquables les créneaux qui n'existent que sur le site Lise (écarts « ajout » ou « horaire »)
//    et qui ne sont pas encore dans events.json : on les ajoute en mémoire le temps du clic.
// 2) Les évaluations (examen) ajoutées sur le site sont aussi listées dans les partiels.
// 3) Deux cas où le lien iCal et le site Lise se contredisent, avec le même fonctionnement :
//    a) Débat : un cours du lien iCal et un cours du site (uid « web-… ») qui se chevauchent dans events.json.
//    b) Horaire : même cours (même uid) mais horaire différent ; l'agenda montre alors les deux versions
//       (colonne iCal et colonne Lise) et on clique sur celle qu'on veut garder.
//    Sans choix : tout est en pointillé dans l'agenda et les deux comptent dans les listes.
//    On coche la version retenue depuis sa fiche : elle passe en trait plein et gras, l'autre reste en pointillé
//    (estompée) et disparaît de la liste de l'accueil et du total d'heures. On peut décocher / recocher à tout moment.
//    Le choix est gardé dans choix.json (dépôt de données) : effectifs (débats) et versions (écart horaire -> ics | lise).
(function () {
	const SEL = "[data-cours],[data-tache-cours],[data-partiel-cours]";
	function chercher(uid) {
		for (const e of ((S.data.ecarts || {}).ecarts || [])) {
			for (const x of [e.apres, e.avant]) if (x && x.uid === uid) return x;
		}
		return null;
	}
	// Côté (colonne iCal ou Lise) du dernier créneau d'agenda touché, pour ouvrir la bonne version dans la fiche
	let coteClic = null;
	document.addEventListener("click", (e) => {
		const b = e.target.closest && e.target.closest(".ag-cours[data-cote]");
		coteClic = b ? { uid: b.dataset.cours, cote: b.dataset.cote } : null;
	}, true);
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

	// ---------- Choix entre lien iCal et site Lise ----------
	const CHOIX0 = { effectifs: [], versions: {} };
	const estWeb = (e) => String(e.uid).startsWith("web-");
	const choisis = () => new Set(((S.data.choix || CHOIX0).effectifs) || []);
	const versionsChoisies = () => ((S.data.choix || CHOIX0).versions) || {};
	const idsDecides = () => {
		const d = S.data.decisions || {};
		return new Set([...(d.appliques || []), ...(d.ignores || [])]);
	};

	// Écarts « horaire » à venir : uid du cours -> écart (versions iCal = avant, Lise = apres)
	function ecartsHoraire() {
		const m = new Map(), a = auj();
		for (const x of ((S.data.ecarts || {}).ecarts || [])) {
			if (x.type !== "horaire" || !x.avant || !x.apres) continue;
			if (jourCle(x.avant.debut) < a && jourCle(x.apres.debut) < a) continue;
			m.set(String(x.avant.uid), x);
		}
		return m;
	}

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

	// Cours à compter dans les listes : sans choix, tout ; avec un choix, seule la version retenue
	function effectifs(liste) {
		const sel = choisis();
		const exclus = new Set();
		for (const g of debats(liste)) {
			if (!g.some((e) => sel.has(e.uid))) continue;
			for (const e of g) if (!sel.has(e.uid)) exclus.add(e.uid);
		}
		let res = (liste || []).filter((e) => !exclus.has(e.uid));
		// Écarts d'horaire : version choisie, ou les deux tant que l'écart n'est ni appliqué ni ignoré
		const ch = versionsChoisies(), decides = idsDecides();
		for (const x of ecartsHoraire().values()) {
			const c = ch[x.id];
			if (!c && decides.has(x.id)) continue;
			const uid = String(x.avant.uid);
			res = res.filter((e) => String(e.uid) !== uid).concat(c === "ics" ? [x.avant] : c === "lise" ? [x.apres] : [x.avant, x.apres]);
		}
		return res;
	}

	const style = document.createElement("style");
	style.textContent = `
.ag-cours.deb-inc{outline:2px dashed currentColor;outline-offset:-2px}
.ag-col.ec-ics .ag-cours.deb-inc.ec-d{outline:2px dashed var(--ec-std,currentColor)}
.ag-col.ec-lise .ag-cours.deb-inc.ec-d{outline:2px dashed var(--ec-lise,currentColor)}
.ag-cours.deb-non,.ag-col.ec-ics .ag-cours.deb-non.ec-d,.ag-col.ec-lise .ag-cours.deb-non.ec-d{opacity:.5;outline:2px dashed currentColor;outline-offset:-2px}
.ag-cours.deb-oui,.ag-col.ec-ics .ag-cours.deb-oui.ec-d,.ag-col.ec-lise .ag-cours.deb-oui.ec-d{opacity:1;outline:3px solid currentColor;outline-offset:-3px}
.ag-cours.deb-oui .ag-t,.ag-cours.deb-oui .ag-h{font-weight:800}
.effectif{margin-top:12px;border-radius:12px;background:rgba(255,200,0,.22);padding:10px 12px}
.effectif label{display:flex;gap:10px;align-items:center;font-weight:600}
.effectif .petit{margin-top:4px}
`;
	document.head.appendChild(style);

	// Total d'heures de la semaine : uniquement les cours effectifs
	const avOrig = window.avancementSemaine;
	if (typeof avOrig === "function") {
		window.avancementSemaine = function (debutSem, finSem, parJour, tachesJour) {
			const eff = effectifs(Object.values(parJour).flat());
			const filtre = {};
			for (const c of Object.keys(parJour)) filtre[c] = eff.filter((e) => jourCle(e.debut) === c);
			return avOrig(debutSem, finSem, filtre, tachesJour);
		};
	}

	// Agenda : pointillés tant qu'aucun choix ; la version retenue passe en plein et gras
	const grilleOrig = window.grilleSemaine;
	if (typeof grilleOrig === "function") {
		window.grilleSemaine = function (...args) {
			let html = grilleOrig.apply(this, args);
			// a) débats (cours iCal et site qui se chevauchent)
			const sel = choisis();
			const marque = new Map();
			for (const g of debats(S.data.events && S.data.events.events)) {
				const decide = g.some((e) => sel.has(e.uid));
				for (const e of g) marque.set(String(e.uid), sel.has(e.uid) ? "deb-oui" : decide ? "deb-non" : "deb-inc");
			}
			if (marque.size) html = html.replace(/<button class="ag-cours ([^"]*)"([^>]*?)data-cours="([^"]*)"/g, (m, cls, mid, u) => marque.has(u) ? `<button class="ag-cours ${cls} ${marque.get(u)}"${mid}data-cours="${u}"` : m);
			// b) horaires différents : une version par colonne (iCal à gauche, Lise à droite)
			const hor = ecartsHoraire();
			if (hor.size && html.includes("ag-col ")) {
				const ch = versionsChoisies(), decides = idsDecides();
				const parts = html.split('<div class="ag-col ');
				for (let i = 1; i < parts.length; i++) {
					const cote = (/^[^"]*\bec-(ics|lise)\b[^"]*"/.exec(parts[i]) || [])[1];
					if (!cote) continue;
					parts[i] = parts[i].replace(/<button class="ag-cours ([^"]*)"([^>]*?)data-cours="([^"]*)"/g, (m, cls, mid, u) => {
						const x = hor.get(u);
						if (!x) return m;
						const c = ch[x.id];
						const k = c ? (c === cote ? "deb-oui" : "deb-non") : decides.has(x.id) ? "" : "deb-inc";
						return `<button class="ag-cours ${cls} ${k}"${mid}data-cote="${cote}" data-cours="${u}"`;
					});
				}
				html = parts.join('<div class="ag-col ');
			}
			return html;
		};
	}

	// Accueil : sans choix tout compte, avec un choix seulement la version retenue
	const accueilOrig = VUES.accueil;
	VUES.accueil = function () {
		const ev = S.data.events;
		if (!ev || !ev.events) return accueilOrig.apply(this, arguments);
		const original = S.data.events;
		S.data.events = { ...original, events: effectifs(original.events) };
		try { return accueilOrig.apply(this, arguments); } finally { S.data.events = original; }
	};

	// Fiche du cours : case « Garder … » quand il y a un débat ou un écart d'horaire
	const detailOrig = window.detailCours;
	if (typeof detailOrig === "function") {
		window.detailCours = function (e) {
			const touche = coteClic && String(coteClic.uid) === String(e.uid) ? coteClic.cote : null;
			coteClic = null;
			const x = ecartsHoraire().get(String(e.uid));
			if (x && touche) {
				// On ouvre la version de la colonne touchée (iCal ou Lise), pas celle d'events.json
				const v = touche === "ics" ? x.avant : x.apres;
				const autre = touche === "ics" ? x.apres : x.avant;
				detailOrig.call(this, v);
				const corps = document.getElementById("feuille-corps");
				if (!corps) return;
				const nom = touche === "ics" ? "lien iCal" : "site Lise";
				const bloc = document.createElement("div");
				bloc.className = "effectif";
				bloc.innerHTML = `<label><input type="checkbox" class="coche" data-version="${h(x.id)}" data-cote="${touche}" ${versionsChoisies()[x.id] === touche ? "checked" : ""}> Garder cette version (${nom})</label>
					<div class="petit">Horaire différent : ${nom} ${heure(v.debut)}–${heure(v.fin)}, ${touche === "ics" ? "site Lise" : "lien iCal"} ${heure(autre.debut)}–${heure(autre.fin)}. Coche celle qui est juste : elle passe en trait plein, l'autre reste en pointillé et ne compte plus dans la liste de l'accueil ni le total d'heures. Tant que rien n'est coché, les deux comptent. Tu peux décocher à tout moment.</div>`;
				const actions = corps.querySelector(".actions");
				if (actions) actions.before(bloc); else corps.appendChild(bloc);
				return;
			}
			detailOrig.apply(this, arguments);
			const g = enDebat(e.uid);
			const corps = document.getElementById("feuille-corps");
			if (!g || !corps) return;
			const autres = g.filter((y) => y.uid !== e.uid).map((y) => `${y.titre} (${estWeb(y) ? "site Lise" : "lien iCal"}) ${heure(y.debut)}–${heure(y.fin)}`).join(" ; ");
			const bloc = document.createElement("div");
			bloc.className = "effectif";
			bloc.innerHTML = `<label><input type="checkbox" class="coche" data-effectif="${h(e.uid)}" ${choisis().has(e.uid) ? "checked" : ""}> Garder ce cours (${estWeb(e) ? "site Lise" : "lien iCal"})</label>
				<div class="petit">Ce créneau chevauche ${h(autres)}. Coche celui qui a vraiment lieu : il passe en trait plein, l'autre reste en pointillé et ne compte plus dans la liste de l'accueil ni le total d'heures. Tant que rien n'est coché, les deux comptent. Tu peux décocher à tout moment.</div>`;
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
			return { ...d, effectifs: eff, versions: d.versions || {} };
		}, "Cours effectif", { defaut: CHOIX0, sansSynchro: true }));
	}
	function basculerVersion(id, cote, coche) {
		return action(() => modifier("choix.json", "choix", (d) => {
			const v = { ...(d.versions || {}) };
			if (coche) v[id] = cote; else delete v[id];
			return { ...d, effectifs: d.effectifs || [], versions: v };
		}, "Version retenue", { defaut: CHOIX0, sansSynchro: true }));
	}
	document.addEventListener("change", (e) => {
		const t = e.target.closest && e.target.closest("[data-effectif],[data-version]");
		if (!t) return;
		const p = t.dataset.version ? basculerVersion(t.dataset.version, t.dataset.cote, t.checked) : basculer(t.dataset.effectif, t.checked);
		p.then(() => { fermerFeuille(); rendre(); }).catch(() => {});
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
