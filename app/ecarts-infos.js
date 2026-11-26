"use strict";
// Onglet Écarts : pour chaque écart, un verdict (sans conséquence / à vérifier / important), l'explication
// et les détails du cours (jour, horaire, durée, salle, intervenant), pour comprendre vite si c'est un problème.
(function () {
	const DEC0 = { appliques: [], ignores: [] };
	const st = document.createElement("style");
	st.textContent = `
.ec-carte{padding:14px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.ec-carte:last-child{border-bottom:0}
.ec-ligne1{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
.ec-badge{font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px;background:#eee}
.ec-badge.t-ajout{background:#dff3e3;color:#1c6b2f}
.ec-badge.t-horaire{background:#fff0d6;color:#8a5a00}
.ec-badge.t-suppression{background:#fbe0e0;color:#9b1c1c}
.ec-badge.v-ok{background:#1c6b2f;color:#fff}
.ec-badge.v-warn{background:#d9822b;color:#fff}
.ec-badge.v-imp{background:#b3261e;color:#fff}
.ec-titre{font-weight:700;font-size:16px;margin:2px 0}
.ec-jour{color:var(--doux,#777);font-size:14px;text-transform:capitalize}
.ec-expl{margin:8px 0 2px;font-size:14px;line-height:1.4}
.ec-conseil{margin:4px 0 0;font-size:13px;color:var(--doux,#777)}
.ec-det{margin-top:8px;border-radius:12px;background:var(--fond-2,#eee);padding:8px 10px;display:grid;gap:8px;font-size:13.5px}
.ec-bloc>span{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:4px;color:#fff;padding:1px 6px;margin-bottom:2px}
.ec-bloc.std>span{background:#2f6fb0}
.ec-bloc.lise>span{background:#d9822b}
.ec-bloc.vide>div{color:var(--doux,#777);font-style:italic}
.ec-bloc small{color:var(--doux,#777)}
.ec-ch{background:rgba(255,200,0,.4);border-radius:4px;padding:0 3px;font-weight:700}
.ec-resume{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 6px}
.ec-resume .ec-badge{font-size:13px;padding:3px 10px}
`;
	document.head.appendChild(st);

	const min = (c) => Math.round((Date.parse(c.fin) - Date.parse(c.debut)) / 60000);
	const dureeTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
	const signe = (m) => `${m > 0 ? "+" : "−"}${dureeTxt(Math.abs(m))}`;
	const refDe = (e) => e.apres || e.avant;
	const chevauche = (a, b) => a.debut < b.fin && b.debut < a.fin;

	// Analyse d'un écart à la lumière des autres (renommage, remplacement…)
	function analyser(e, tous) {
		const c = refDe(e);
		const exam = !!c.examen;
		const autres = tous.filter((x) => x.id !== e.id);
		if (e.type === "horaire") {
			const d0 = Math.round((Date.parse(e.apres.debut) - Date.parse(e.avant.debut)) / 60000);
			const d1 = Math.round((Date.parse(e.apres.fin) - Date.parse(e.avant.fin)) / 60000);
			const salle = (e.avant.salle || "") !== (e.apres.salle || "");
			const parts = [];
			if (d0 !== 0 && d0 === d1) parts.push(`Le cours est décalé de ${signe(d0)} (même durée ${dureeTxt(min(e.apres))}).`);
			else {
				if (d0 !== 0) parts.push(`Le début change de ${signe(d0)}.`);
				if (d1 !== 0) parts.push(`La fin change de ${signe(d1)}.`);
				const dd = min(e.apres) - min(e.avant);
				if (dd) parts.push(`Durée ${dureeTxt(min(e.avant))} → ${dureeTxt(min(e.apres))}.`);
			}
			if (salle) parts.push(`Salle ${e.avant.salle || "?"} → ${e.apres.salle || "?"}.`);
			const petit = Math.abs(d0) <= 15 && Math.abs(d1) <= 15 && !salle && !exam;
			return exam
				? { niveau: "imp", verdict: "Important : évaluation", expl: parts.join(" ") + " C'est une évaluation : le site Lise est en général plus à jour.", conseil: "Conseil : appliquer." }
				: petit ? { niveau: "ok", verdict: "Sans conséquence", expl: parts.join(" ") + " Petit ajustement.", conseil: "Conseil : appliquer (le site est plus précis)." }
					: { niveau: "warn", verdict: "À vérifier", expl: parts.join(" ") + " Ton horaire change : vérifie que ça n'entre pas en conflit.", conseil: "Conseil : appliquer, sauf si tu as déjà été prévenu autrement." };
		}
		if (e.type === "suppression") {
			const av = e.avant;
			const jumeau = autres.find((x) => x.type === "ajout" && x.apres.debut === av.debut && x.apres.fin === av.fin);
			if (jumeau) {
				const memeSalle = (jumeau.apres.salle || "") === (av.salle || "");
				const memeProf = !av.profs || !jumeau.apres.profs || jumeau.apres.profs === av.profs;
				if (memeSalle && memeProf) return { niveau: "ok", verdict: "Sans conséquence", expl: `Même créneau, même salle, même intervenant : c'est le même cours, seulement renommé sur le site (« ${jumeau.apres.titre} », ${jumeau.apres.type}). Ton cours n'est pas annulé.`, conseil: "Conseil : appliquer (ou ignorer, aucun effet sur ton emploi du temps)." };
				return { niveau: "warn", verdict: "À vérifier", expl: `Un autre cours le remplace sur le même créneau : « ${jumeau.apres.titre} »${memeSalle ? "" : `, salle ${jumeau.apres.salle || "?"}`}${memeProf ? "" : `, avec ${jumeau.apres.profs}`}.`, conseil: "Conseil : appliquer." };
			}
			const reprise = autres.find((x) => (x.type === "horaire" || x.type === "ajout") && x.apres.salle && x.apres.salle === av.salle && chevauche(x.apres, av));
			if (reprise) return { niveau: "warn", verdict: "À vérifier", expl: `Le créneau est repris dans la même salle (${av.salle}) par « ${reprise.apres.titre} » (${reprise.apres.type}) ${heure(reprise.apres.debut)}–${heure(reprise.apres.fin)}. Probablement remplacé, pas simplement annulé.`, conseil: "Conseil : appliquer." };
			return exam
				? { niveau: "imp", verdict: "Important : évaluation", expl: "Cette évaluation n'apparaît plus sur le site : annulée ou déplacée ?", conseil: "Conseil : vérifier auprès de l'école avant d'appliquer." }
				: { niveau: "warn", verdict: "À vérifier", expl: "Le cours est encore dans ton lien iCal mais plus sur le site : probablement annulé ou déplacé, sans cours qui le remplace.", conseil: "Conseil : appliquer si tu sais qu'il est annulé, sinon vérifier." };
		}
		// ajout
		const ap = e.apres;
		const jumeau = autres.find((x) => x.type === "suppression" && x.avant.debut === ap.debut && x.avant.fin === ap.fin);
		if (jumeau) {
			const memeSalle = (jumeau.avant.salle || "") === (ap.salle || "");
			const memeProf = !jumeau.avant.profs || !ap.profs || jumeau.avant.profs === ap.profs;
			if (memeSalle && memeProf) return { niveau: "ok", verdict: "Sans conséquence", expl: `Même créneau, même salle, même intervenant que « ${jumeau.avant.titre} » du lien iCal : c'est le même cours avec un nom différent.`, conseil: "Conseil : appliquer (ou ignorer, aucun effet sur ton emploi du temps)." };
			return { niveau: "warn", verdict: "À vérifier", expl: `Remplace « ${jumeau.avant.titre} » sur le même créneau${memeSalle ? "" : `, salle ${jumeau.avant.salle || "?"} → ${ap.salle || "?"}`}${memeProf ? "" : `, intervenant ${jumeau.avant.profs} → ${ap.profs}`}.`, conseil: "Conseil : appliquer." };
		}
		const remplace = autres.find((x) => x.type === "suppression" && x.avant.salle && x.avant.salle === ap.salle && chevauche(x.avant, ap));
		return exam
			? { niveau: "imp", verdict: "Important : évaluation", expl: "Nouvelle évaluation sur le site, absente de ton lien iCal.", conseil: "Conseil : appliquer." }
			: { niveau: "warn", verdict: "À vérifier", expl: `Cours présent sur le site mais absent de ton lien iCal : nouvelle séance ou séance ajoutée.${remplace ? ` Il prend la place de « ${remplace.avant.titre} » (même salle).` : ""}`, conseil: "Conseil : appliquer (le site est plus à jour)." };
	}

	function bloc(nom, cls, c, autre) {
		if (!c) return `<div class="ec-bloc vide ${cls}"><span>${nom}</span><div>absent</div></div>`;
		const v = (k, t) => (autre && k(autre) !== k(c) ? `<span class="ec-ch">${h(t)}</span>` : h(t));
		const g = { jour: (x) => fmt(x.debut, { weekday: "long", day: "numeric", month: "long" }), h: (x) => `${heure(x.debut)}–${heure(x.fin)}`, salle: (x) => x.salle || "—", profs: (x) => x.profs || "—", titre: (x) => `${x.titre || x.module || "—"}${x.type ? ` (${x.type})` : ""}`, grp: (x) => x.groupes || "—" };
		return `<div class="ec-bloc ${cls}"><span>${nom}</span>
			<div><b>${v(g.titre, g.titre(c))}</b></div>
			<div>${v(g.jour, g.jour(c))} · ${v(g.h, g.h(c))} <small>(${dureeTxt(min(c))})</small></div>
			<div><small>Salle</small> ${v(g.salle, g.salle(c))} · <small>Intervenant</small> ${v(g.profs, g.profs(c))}</div>
			<div><small>${h(g.grp(c))}</small></div></div>`;
	}

	const LIB = { ajout: "Ajout", horaire: "Horaire", suppression: "Absent du site" };
	const NIV = { ok: "v-ok", warn: "v-warn", imp: "v-imp" };

	VUES.ecarts = function () {
		const d = S.data.decisions || DEC0;
		const decides = new Set([...(d.appliques || []), ...(d.ignores || [])]);
		const a = auj();
		const tous = ((S.data.ecarts || {}).ecarts || []).filter((e) => jourCle(refDe(e).debut) >= a);
		const liste = tous.filter((e) => !decides.has(e.id)).sort((x, y) => refDe(x).debut.localeCompare(refDe(y).debut));
		const maj = (S.data.ecarts || {}).majLe;
		const an = new Map(liste.map((e) => [e.id, analyser(e, tous)]));
		const compte = (n) => liste.filter((e) => an.get(e.id).niveau === n).length;
		const carte = (e) => {
			const r = an.get(e.id), c = refDe(e);
			return `<div class="ec-carte">
				<div class="ec-ligne1"><span class="ec-badge t-${h(e.type)}">${h(LIB[e.type] || e.type)}</span><span class="ec-badge ${NIV[r.niveau]}">${h(r.verdict)}</span></div>
				<div class="ec-titre">${h(c.titre || c.module)}${c.type ? ` (${h(c.type)})` : ""}</div>
				<div class="ec-jour">${h(fmt(c.debut, { weekday: "long", day: "numeric", month: "long" }))}</div>
				<p class="ec-expl">${h(r.expl)}</p><p class="ec-conseil">${h(r.conseil)}</p>
				<div class="ec-det">${bloc("Standard (lien iCal)", "std", e.avant, e.apres)}${bloc("Lise (site)", "lise", e.apres, e.avant)}</div>
				<div class="ec-actions" style="display:flex;gap:8px;margin-top:10px"><button class="bouton plein petit-b" data-ec-app="${h(e.id)}">Appliquer</button><button class="bouton petit-b" data-ec-ign="${h(e.id)}">Ignorer</button></div></div>`;
		};
		return `<section class="carte"><h2>Planning : lien Lise ≠ site Lise</h2>
			<p class="petit">Le site Lise est en général plus à jour que le lien iCal (surtout pour les partiels). Rien n'est modifié sans ton accord. Un écart appliqué est ajouté à ton calendrier à la prochaine synchro (1 à 2 minutes).${maj ? ` Vérifié ${h(fmt(maj, { weekday: "short", hour: "2-digit", minute: "2-digit" }))}.` : ""}</p>
			${liste.length ? `<div class="ec-resume">${compte("imp") ? `<span class="ec-badge v-imp">${compte("imp")} important${compte("imp") > 1 ? "s" : ""}</span>` : ""}${compte("warn") ? `<span class="ec-badge v-warn">${compte("warn")} à vérifier</span>` : ""}${compte("ok") ? `<span class="ec-badge v-ok">${compte("ok")} sans conséquence</span>` : ""}</div>
			<div class="ec-tete"><button class="bouton plein petit-b" data-ec-tout="app">Tout appliquer (${liste.length})</button><button class="bouton petit-b" data-ec-tout="ign">Tout ignorer</button></div>${liste.map(carte).join("")}` : '<p class="vide">Aucun écart à traiter.</p>'}</section>`;
	};
	rendre();
})();
