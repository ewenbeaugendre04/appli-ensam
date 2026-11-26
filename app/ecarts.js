"use strict";
// Onglet « Écarts » : différences entre le lien iCal de Lise et le site Lise.
// Chaque écart peut être appliqué ou ignoré ; le choix est écrit dans decisions.json (dépôt de données),
// puis la synchro est relancée (voir relancerSynchro dans app.js).

(function () {
	const DEC0 = { appliques: [], ignores: [] };
	const style = document.createElement("style");
	style.textContent = `
.accueil-haut .pastilles{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pastille-ecarts{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--carte,#fff);border:1px solid rgba(122,31,43,.25);color:#7a1f2b;font-weight:600;font-size:14px;text-decoration:none}
.pastille-ecarts svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pastille-ecarts b{background:#7a1f2b;color:#fff;border-radius:999px;font-size:12px;padding:1px 7px}
.ecart{padding:12px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.ecart:last-child{border-bottom:0}
.ecart .ec-type{display:inline-block;font-size:12px;font-weight:700;border-radius:6px;padding:2px 7px;margin-bottom:4px;background:#eee}
.ecart .ec-ajout{background:#dff3e3;color:#1c6b2f}
.ecart .ec-horaire{background:#fff0d6;color:#8a5a00}
.ecart .ec-suppression{background:#fbe0e0;color:#9b1c1c}
.ecart .ec-actions{display:flex;gap:8px;margin-top:8px}
.ec-tete{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
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

	async function chargerEcarts() {
		if (!S.token) return;
		try {
			const [ecarts, decisions] = await Promise.all([lire("ecarts.json", { ecarts: [] }), lire("decisions.json", DEC0)]);
			S.data.ecarts = ecarts;
			S.data.decisions = decisions;
			sauverCache();
			if (S.vue === "accueil" || S.vue === "ecarts") rendre();
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
			<div>${h(e.resume)}</div>
			<div class="ec-actions"><button class="bouton plein petit-b" data-ec-app="${h(e.id)}">Appliquer</button><button class="bouton petit-b" data-ec-ign="${h(e.id)}">Ignorer</button></div></div>`;
		return `<section class="carte"><h2>Planning : lien Lise ≠ site Lise</h2>
			<p class="petit">Le site Lise est en général plus à jour que le lien iCal (surtout pour les partiels). Rien n'est modifié sans ton accord.${maj ? ` Vérifié ${h(fmt(maj, { weekday: "short", hour: "2-digit", minute: "2-digit" }))}.` : ""}</p>
			${liste.length ? `<div class="ec-tete"><button class="bouton plein petit-b" data-ec-tout="app">Tout appliquer (${liste.length})</button><button class="bouton petit-b" data-ec-tout="ign">Tout ignorer</button></div>${liste.map(carte).join("")}` : '<p class="vide">Aucun écart à traiter.</p>'}</section>`;
	};

	const accueilOrig = VUES.accueil;
	VUES.accueil = function () {
		const html = accueilOrig();
		const n = enAttente().length;
		const pastille = `<a href="#ecarts" class="pastille-ecarts" aria-label="Écarts de planning${n ? ` (${n})` : ""}"><svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/></svg>Écarts${n ? `<b>${n}</b>` : ""}</a>`;
		return html.replace(/<a href="#notes"[\s\S]*?<\/a>/, (m) => `<span class="pastilles">${pastille}${m}</span>`);
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
