"use strict";
// Choix entre le lien iCal et le site Lise quand ils se contredisent. Deux cas, même fonctionnement :
//  a) Débat : un cours du lien iCal et un cours du site (uid « web-… ») se chevauchent dans events.json.
//  b) Horaire : même cours (même uid) mais horaire différent ; l'agenda montre alors les deux versions
//     (colonne iCal à gauche, colonne Lise à droite).
// Sans choix : tout est en pointillé dans l'agenda et les deux versions comptent dans les listes.
// On coche la version retenue depuis sa fiche : elle passe en trait plein et gras, l'autre reste en pointillé
// (estompée) et disparaît de la liste de l'accueil et du total d'heures. On peut décocher / recocher à tout moment.
// Le choix est gardé dans choix.json (dépôt de données) : effectifs (débats : uid retenus) et
// versions (écarts horaire : id de l'écart -> "ics" | "lise").
(function () {
	const CHOIX0 = { effectifs: [], versions: {} };
	const estWeb = (e) => String(e.uid).startsWith("web-");
	const effectifsChoisis = () => new Set(((S.data.choix || CHOIX0).effectifs) || []);
	const versionsChoisies = () => ((S.data.choix || CHOIX0).versions) || {};
	const idsDecides = () => {
		const d = S.data.decisions || {};
		return new Set([...(d.appliques || []), ...(d.ignores || [])]);
	};
	const libelleCote = (cote) => (cote === "ics" ? "lien iCal" : "site Lise");

	// ---------- Détection ----------

	// Écarts « horaire » à venir : uid du cours -> écart (version iCal = avant, version Lise = apres)
	function ecartsHoraire() {
		const m = new Map(), aujourdhui = auj();
		for (const x of ((S.data.ecarts || {}).ecarts || [])) {
			if (x.type !== "horaire" || !x.avant || !x.apres) continue;
			if (jourCle(x.avant.debut) < aujourdhui && jourCle(x.apres.debut) < aujourdhui) continue;
			m.set(String(x.avant.uid), x);
		}
		return m;
	}

	// Groupes de cours qui se chevauchent et mélangent iCal et site
	function debats(liste) {
		const evs = (liste || []).filter((e) => !e.journee).sort((a, b) => a.debut.localeCompare(b.debut));
		const groupes = [];
		let courant = null, fin = "";
		for (const e of evs) {
			if (courant && e.debut < fin) { courant.push(e); if (e.fin > fin) fin = e.fin; }
			else { courant = [e]; groupes.push(courant); fin = e.fin; }
		}
		return groupes.filter((g) => g.length > 1 && g.some(estWeb) && g.some((e) => !estWeb(e)));
	}
	const debatsDuJour = () => debats(S.data.events && S.data.events.events);
	const debatDe = (uid) => debatsDuJour().find((g) => g.some((e) => e.uid === uid)) || null;

	// Cours à compter dans les listes : sans choix, tout ; avec un choix, seule la version retenue
	function effectifs(liste) {
		const retenus = effectifsChoisis();
		const exclus = new Set();
		for (const g of debats(liste)) {
			if (!g.some((e) => retenus.has(e.uid))) continue;
			for (const e of g) if (!retenus.has(e.uid)) exclus.add(e.uid);
		}
		let res = (liste || []).filter((e) => !exclus.has(e.uid));
		// Écarts d'horaire : version choisie, ou les deux tant que l'écart n'est ni appliqué ni ignoré
		const versions = versionsChoisies(), decides = idsDecides();
		for (const x of ecartsHoraire().values()) {
			const cote = versions[x.id];
			if (!cote && decides.has(x.id)) continue;
			const uid = String(x.avant.uid);
			const gardees = cote === "ics" ? [x.avant] : cote === "lise" ? [x.apres] : [x.avant, x.apres];
			res = res.filter((e) => String(e.uid) !== uid).concat(gardees);
		}
		return res;
	}

	// ---------- Style ----------
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

	// ---------- Listes : total d'heures et accueil ----------
	const avancementOrig = window.avancementSemaine;
	if (typeof avancementOrig === "function") {
		window.avancementSemaine = function (debutSem, finSem, parJour, tachesJour) {
			const retenus = effectifs(Object.values(parJour).flat());
			const filtre = {};
			for (const c of Object.keys(parJour)) filtre[c] = retenus.filter((e) => jourCle(e.debut) === c);
			return avancementOrig(debutSem, finSem, filtre, tachesJour);
		};
	}

	const accueilOrig = VUES.accueil;
	VUES.accueil = function () {
		const ev = S.data.events;
		if (!ev || !ev.events) return accueilOrig.apply(this, arguments);
		const original = S.data.events;
		S.data.events = { ...original, events: effectifs(original.events) };
		try { return accueilOrig.apply(this, arguments); } finally { S.data.events = original; }
	};

	// ---------- Agenda : pointillés tant qu'aucun choix ; la version retenue passe en plein et gras ----------
	const RE_COURS = /<button class="ag-cours ([^"]*)"([^>]*?)data-cours="([^"]*)"/g;
	const grilleOrig = window.grilleSemaine;
	if (typeof grilleOrig === "function") {
		window.grilleSemaine = function (...args) {
			let html = grilleOrig.apply(this, args);

			// a) débats (cours iCal et site qui se chevauchent)
			const retenus = effectifsChoisis();
			const marque = new Map();
			for (const g of debatsDuJour()) {
				const decide = g.some((e) => retenus.has(e.uid));
				for (const e of g) marque.set(String(e.uid), retenus.has(e.uid) ? "deb-oui" : decide ? "deb-non" : "deb-inc");
			}
			if (marque.size) html = html.replace(RE_COURS, (m, cls, mid, uid) => marque.has(uid) ? `<button class="ag-cours ${cls} ${marque.get(uid)}"${mid}data-cours="${uid}"` : m);

			// b) horaires différents : une version par colonne ; data-cote dit à la fiche quelle version ouvrir
			const horaires = ecartsHoraire();
			if (horaires.size && html.includes("ag-col ")) {
				const versions = versionsChoisies(), decides = idsDecides();
				const morceaux = html.split('<div class="ag-col ');
				for (let i = 1; i < morceaux.length; i++) {
					const cote = (/^[^"]*\bec-(ics|lise)\b[^"]*"/.exec(morceaux[i]) || [])[1];
					if (!cote) continue;
					morceaux[i] = morceaux[i].replace(RE_COURS, (m, cls, mid, uid) => {
						const x = horaires.get(uid);
						if (!x) return m;
						const choisi = versions[x.id];
						const etat = choisi ? (choisi === cote ? "deb-oui" : "deb-non") : decides.has(x.id) ? "" : "deb-inc";
						return `<button class="ag-cours ${cls} ${etat}"${mid}data-cote="${cote}" data-cours="${uid}"`;
					});
				}
				html = morceaux.join('<div class="ag-col ');
			}
			return html;
		};
	}

	// ---------- Fiche du cours : case « Garder … » ----------
	// Colonne (iCal ou Lise) du dernier créneau d'agenda touché, pour ouvrir la bonne version dans la fiche
	let coteTouche = null;
	document.addEventListener("click", (e) => {
		const b = e.target.closest && e.target.closest(".ag-cours[data-cote]");
		coteTouche = b ? { uid: b.dataset.cours, cote: b.dataset.cote } : null;
	}, true);

	function ajouterBloc(html) {
		const corps = document.getElementById("feuille-corps");
		if (!corps) return;
		const bloc = document.createElement("div");
		bloc.className = "effectif";
		bloc.innerHTML = html;
		const actions = corps.querySelector(".actions");
		if (actions) actions.before(bloc); else corps.appendChild(bloc);
	}
	const aideFin = (pronom) => `${pronom} passe en trait plein, l'autre reste en pointillé et ne compte plus dans la liste de l'accueil ni le total d'heures. Tant que rien n'est coché, les deux comptent. Tu peux décocher à tout moment.`;

	const detailOrig = window.detailCours;
	if (typeof detailOrig === "function") {
		window.detailCours = function (e) {
			const cote = coteTouche && String(coteTouche.uid) === String(e.uid) ? coteTouche.cote : null;
			coteTouche = null;

			// Écart d'horaire : on ouvre la version de la colonne touchée, pas celle d'events.json
			const x = ecartsHoraire().get(String(e.uid));
			if (x && cote) {
				const v = cote === "ics" ? x.avant : x.apres;
				const autre = cote === "ics" ? x.apres : x.avant;
				detailOrig.call(this, v);
				ajouterBloc(`<label><input type="checkbox" class="coche" data-version="${h(x.id)}" data-cote="${cote}" ${versionsChoisies()[x.id] === cote ? "checked" : ""}> Garder cette version (${libelleCote(cote)})</label>
					<div class="petit">Horaire différent : ${libelleCote(cote)} ${heure(v.debut)}–${heure(v.fin)}, ${cote === "ics" ? "site Lise" : "lien iCal"} ${heure(autre.debut)}–${heure(autre.fin)}. Coche celle qui est juste : ${aideFin("elle")}</div>`);
				return;
			}

			// Débat : cours iCal et cours du site qui se chevauchent
			detailOrig.apply(this, arguments);
			const g = debatDe(e.uid);
			if (!g) return;
			const autres = g.filter((y) => y.uid !== e.uid).map((y) => `${y.titre} (${estWeb(y) ? "site Lise" : "lien iCal"}) ${heure(y.debut)}–${heure(y.fin)}`).join(" ; ");
			ajouterBloc(`<label><input type="checkbox" class="coche" data-effectif="${h(e.uid)}" ${effectifsChoisis().has(e.uid) ? "checked" : ""}> Garder ce cours (${estWeb(e) ? "site Lise" : "lien iCal"})</label>
				<div class="petit">Ce créneau chevauche ${h(autres)}. Coche celui qui a vraiment lieu : ${aideFin("il")}</div>`);
		};
	}

	// ---------- Enregistrement du choix (choix.json) ----------
	const enregistrer = (message, fn) => action(() => modifier("choix.json", "choix", fn, message, { defaut: CHOIX0, sansSynchro: true }));

	function basculerCours(uid, coche) {
		const g = debatDe(uid);
		const ids = g ? g.map((x) => x.uid) : [uid];
		return enregistrer("Cours effectif", (d) => {
			const effectifs = (d.effectifs || []).filter((x) => !ids.includes(x));
			if (coche) effectifs.push(uid);
			return { ...d, effectifs, versions: d.versions || {} };
		});
	}
	function basculerVersion(id, cote, coche) {
		return enregistrer("Version retenue", (d) => {
			const versions = { ...(d.versions || {}) };
			if (coche) versions[id] = cote; else delete versions[id];
			return { ...d, effectifs: d.effectifs || [], versions };
		});
	}
	document.addEventListener("change", (e) => {
		const t = e.target.closest && e.target.closest("[data-effectif],[data-version]");
		if (!t) return;
		const fait = t.dataset.version ? basculerVersion(t.dataset.version, t.dataset.cote, t.checked) : basculerCours(t.dataset.effectif, t.checked);
		fait.then(() => { fermerFeuille(); rendre(); }).catch(() => {});
	});

	// ---------- Chargement ----------
	async function chargerChoix() {
		if (!S.token) return;
		try {
			// Lire avant d'écrire dans S.data : app.js remplace S.data une fois sa propre lecture terminée
			const choix = await lire("choix.json", CHOIX0);
			S.data.choix = choix;
			sauverCache();
			if (S.vue === "accueil" || S.vue === "agenda") rendre();
		} catch {}
	}
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chargerChoix(); });
	window.addEventListener("online", chargerChoix);
	chargerChoix();
})();
