"use strict";
// ---------- Module Python (Salome-Meca / Code_Aster) ----------
// Python tourne dans le navigateur (Pyodide, dans un Worker). Code_Aster et Salome sont simulés
// (py/simu.py) : mêmes commandes et mots-clés, erreurs typiques, résultats analytiques.

const PY = { worker: null, attente: new Map(), n: 0, pret: false, chargement: null, exos: null, fait: null, code: {}, essais: {} };
const PY_SIMU = new URL("py/simu.py", location.href).href;

function pyWorker() {
	if (PY.worker) return PY.worker;
	PY.worker = new Worker("py-worker.js");
	PY.worker.onmessage = (e) => { const p = PY.attente.get(e.data.id); if (p) { PY.attente.delete(e.data.id); p(e.data); } };
	return PY.worker;
}
function pyEnvoyer(msg, delai = 0) {
	return new Promise((ok) => {
		const id = ++PY.n;
		let fini = false;
		PY.attente.set(id, (r) => { fini = true; ok(r); });
		pyWorker().postMessage({ id, simuUrl: PY_SIMU, ...msg });
		if (delai) setTimeout(() => {
			if (fini) return;
			// Boucle infinie ou calcul trop long : on arrête Python et on repart de zéro
			PY.worker.terminate(); PY.worker = null; PY.pret = false; PY.chargement = null; PY.attente.clear();
			ok({ ok: true, resultat: { sortie: "", images: [], tests: [], erreur: { type: "Temps dépassé", message: `Ton code tourne depuis plus de ${delai / 1000} s : une boucle infinie ? (vérifie la condition de ton while)`, ligne: null } } });
		}, delai);
	});
}
function pyDemarrer() {
	if (PY.pret) return Promise.resolve();
	if (!PY.chargement) PY.chargement = pyEnvoyer({ type: "init" }).then((r) => { if (!r.ok) { PY.chargement = null; throw new Error(r.message); } PY.pret = true; });
	return PY.chargement;
}

async function pyCharger() {
	if (!PY.exos) {
		const d = await lire("revision/python/exercices.json", { exercices: [] }).catch(() => ({ exercices: [] }));
		PY.exos = d.exercices || [];
	}
	if (!PY.fait) PY.fait = { ...store.get("ae.pyFait", {}), ...(await lire("revision/python/progres.json", {}).catch(() => ({}))) };
	PY.code = store.get("ae.pyCode", {});
}
const pyEx = (id) => (PY.exos || []).find((e) => e.id === id);

// Messages d'erreur Python traduits, avec la piste la plus probable
function pyExpliquerErreur(err) {
	const t = err.type, m = err.message || "";
	const pistes = {
		SyntaxError: "Erreur de syntaxe : il manque souvent un « : » après if/for/def, une parenthèse, ou il reste des « ... » à remplacer.",
		IndentationError: "Décalage incorrect : sous un if/for/def, chaque ligne doit être décalée de 4 espaces (touche ⇥).",
		NameError: "Un nom n'existe pas : faute de frappe, majuscule, ou variable utilisée avant d'être créée.",
		TypeError: /ellipsis/.test(m) ? "Il reste des « ... » dans ton code : remplace-les par ta réponse." : "Mauvais type : tu combines par exemple un texte et un nombre, ou tu appelles une fonction avec de mauvais arguments.",
		ZeroDivisionError: "Division par zéro.",
		IndexError: "Indice hors de la liste : une liste de n éléments va de 0 à n−1.",
		KeyError: "Cette clé n'existe pas dans le dictionnaire (vérifie l'orthographe).",
		AttributeError: "Cet objet n'a pas cette méthode / cet attribut (vérifie le nom).",
		ValueError: "Valeur incorrecte (par exemple max() sur une liste vide, ou conversion float() impossible).",
		AsterError: "Erreur Code_Aster : lis le message <F>, il dit quel mot-clé ou quel groupe pose problème.",
		ModuleNotFoundError: "Ce module n'est pas disponible ici.",
	};
	return `<div class="py-err"><b>${h(t)}${err.ligne ? ` · ligne ${err.ligne}` : ""}</b><pre>${h(m)}</pre><div class="petit">💡 ${h(pistes[t] || "Lis le message : il indique la ligne et la cause.")}</div></div>`;
}

function vuePython() {
	if (!PY.exos) { pyCharger().then(rendre); return `<section class="carte"><p class="vide">Chargement des exercices…</p></section>`; }
	if (R.pyEx === "__bac") return vuePyExercice({ id: "__bac", titre: "Bac à sable", theme: "Libre", niveau: 1, consigne: "Écris et exécute ce que tu veux. Code_Aster et Salome simulés sont disponibles : commence par `import simu; simu.preparer('barre'); simu.installer(globals())`, ou `from salome.geom import geomBuilder`.", depart: "import numpy as np\nprint(np.linspace(0, 1, 5))\n", prepa: "", test: "" });
	if (R.pyEx && pyEx(R.pyEx)) return vuePyExercice(pyEx(R.pyEx));
	const themes = {};
	for (const e of PY.exos) (themes[e.theme] ||= []).push(e);
	const nbFait = PY.exos.filter((e) => PY.fait[e.id]).length;
	const suivant = PY.exos.find((e) => !PY.fait[e.id]);
	return `<button class="bouton petit-b" data-r-retour>‹ Révisions</button>
	<section class="carte py-tete"><h2>🐍 Python pour Salome-Meca et Code_Aster</h2>
		<p>Exerce-toi en direct : tu écris le code, tu l'exécutes, il est corrigé tout de suite, avec les résultats et les graphiques. Code_Aster et Salome sont <b>simulés</b> : mêmes commandes et mots-clés que les vrais, mêmes erreurs typiques, mais des résultats analytiques au lieu d'un vrai calcul éléments finis.</p>
		<div class="r-barre"><span style="width:${PY.exos.length ? Math.round((100 * nbFait) / PY.exos.length) : 0}%"></span></div>
		<p class="petit">${nbFait} / ${PY.exos.length} exercices réussis · Le premier lancement télécharge Python (≈ 10 Mo), ensuite il reste en cache.</p>
		<div class="rang">${suivant ? `<button class="bouton plein" data-py-ouvrir="${h(suivant.id)}">▶ Continuer : ${h(suivant.titre)}</button>` : ""}<button class="bouton" data-py-ouvrir="__bac">🧪 Bac à sable</button></div>
	</section>
	${Object.entries(themes).map(([t, l]) => `<section class="carte"><h2>${h(t)}</h2>${l.map((e) => `<div class="ligne cliquable" data-py-ouvrir="${h(e.id)}"><div class="corps"><div class="t">${PY.fait[e.id] ? "✅ " : ""}${h(e.titre)}</div><div class="s">${"●".repeat(e.niveau)}${"○".repeat(3 - e.niveau)}</div></div></div>`).join("")}</section>`).join("")}`;
}

const PY_TOUCHES = [["⇥", "    "], [":", ":"], ["(", "("], [")", ")"], ["[", "["], ["]", "]"], ["=", "="], ["'", "'"], ['"', '"'], ["_", "_"], [",", ","], [".", "."], ["#", "# "], ["*", "*"], ["/", "/"], ["_F(", "_F("]];

function vuePyExercice(e) {
	const code = PY.code[e.id] ?? e.depart;
	const essais = PY.essais[e.id] || 0;
	const idx = PY.exos.indexOf(e);
	return `<button class="bouton petit-b" data-py-liste>‹ Python</button>
	<section class="carte py-ex">
		<div class="r-type">${h(e.theme)} · ${"●".repeat(e.niveau)}${"○".repeat(3 - e.niveau)}${PY.fait[e.id] ? " · ✅ réussi" : ""}</div>
		<div class="py-titre">${h(e.titre)}</div>
		<div class="r-md">${md(e.consigne)}</div>
		<div class="py-editeur-zone">
			<div class="py-touches">${PY_TOUCHES.map(([l, v]) => `<button type="button" class="py-touche" data-py-ins="${h(v)}">${h(l)}</button>`).join("")}</div>
			<textarea id="py-code" class="py-code" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" data-py-id="${h(e.id)}">${h(code)}</textarea>
		</div>
		<div class="rang py-actions">
			<button class="bouton" data-py-run="exec">▶ Exécuter</button>
			${e.test ? `<button class="bouton plein" data-py-run="verif">✓ Vérifier</button>` : ""}
			${(e.indices || []).length ? `<button class="bouton" data-py-indice>💡 Indice</button>` : ""}
			${e.solution && (essais >= 2 || PY.fait[e.id]) ? `<button class="bouton" data-py-solution>Solution</button>` : ""}
			<button class="bouton" data-py-reset title="Revenir au code de départ">↺</button>
		</div>
		<div id="py-indices"></div>
		<div id="py-sortie" class="py-sortie" hidden></div>
		${idx >= 0 && idx < PY.exos.length - 1 ? `<div class="py-suivant" id="py-suivant" ${PY.fait[e.id] ? "" : "hidden"}><button class="bouton plein large" data-py-ouvrir="${h(PY.exos[idx + 1].id)}">Exercice suivant ›</button></div>` : ""}
	</section>`;
}

function pyAfficher(res, e, verif) {
	const z = $("#py-sortie"); if (!z) return;
	z.hidden = false;
	const r = res.resultat || {};
	let html = "";
	if (!res.ok) html += `<div class="py-err"><b>Python n'a pas pu démarrer</b><pre>${h(res.message || "")}</pre><div class="petit">Vérifie ta connexion (le premier lancement télécharge Python).</div></div>`;
	if (r.sortie) html += `<div class="py-bloc-t">Sortie</div><pre class="py-console">${h(r.sortie)}</pre>`;
	if (r.erreur) html += pyExpliquerErreur(r.erreur);
	for (const img of r.images || []) html += `<img class="py-img" alt="Graphique" src="data:image/png;base64,${img}">`;
	if (verif && !r.erreur && e.test) {
		const tests = r.tests || [];
		const ok = tests.length && tests.every((t) => t.ok);
		html += `<div class="py-bloc-t">Correction</div><ul class="py-tests">${tests.map((t) => `<li class="${t.ok ? "ok" : "ko"}">${t.ok ? "✔" : "✗"} ${inline(h(String(t.msg).replace(/\s*✔\s*$/, "")))}</li>`).join("")}</ul>`;
		if (ok) {
			html += `<div class="py-bravo">🎉 Réussi !</div>${e.explication ? `<div class="r-aide py-expl"><div class="r-md">${md(e.explication)}</div></div>` : ""}`;
			pyReussi(e.id);
		} else html += `<p class="petit">Corrige ce qui est marqué ✗ puis vérifie à nouveau.${(PY.essais[e.id] || 0) >= 2 ? " La solution est disponible." : ""}</p>`;
	}
	if (!html) html = `<p class="petit">Exécuté, sans rien afficher. Utilise <code>print(...)</code> pour voir des valeurs.</p>`;
	z.innerHTML = html;
	formules(z);
	z.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pyReussi(id) {
	if (PY.fait[id]) { $("#py-suivant") && ($("#py-suivant").hidden = false); return; }
	PY.fait[id] = new Date().toISOString();
	store.set("ae.pyFait", PY.fait);
	$("#py-suivant") && ($("#py-suivant").hidden = false);
	if (S.token) modifier("revision/python/progres.json", "pyProgres", (p) => ({ ...p, [id]: PY.fait[id] }), `Python : exercice ${id} réussi`, { defaut: {}, sansSynchro: true }).catch(() => {});
}

async function pyLancer(verif) {
	const ta = $("#py-code"); if (!ta) return;
	const id = ta.dataset.pyId;
	const e = id === "__bac" ? { id, test: "", prepa: "" } : pyEx(id);
	const z = $("#py-sortie");
	z.hidden = false;
	z.innerHTML = `<p class="petit">${PY.pret ? "⏳ Exécution…" : "⏳ Démarrage de Python (première fois : quelques secondes, ≈ 10 Mo)…"}</p>`;
	document.querySelectorAll("[data-py-run]").forEach((b) => (b.disabled = true));
	try {
		await pyDemarrer();
		if (/numpy|matplotlib/.test(ta.value + (e.prepa || "") + (e.test || ""))) z.innerHTML = `<p class="petit">⏳ Exécution (chargement de numpy / matplotlib la première fois)…</p>`;
		if (verif) PY.essais[id] = (PY.essais[id] || 0) + 1;
		const res = await pyEnvoyer({ code: ta.value, prepa: e.prepa, test: e.test, verifier: verif }, 30000);
		pyAfficher(res, e, verif);
		if (verif && (PY.essais[id] || 0) >= 2 && !$("[data-py-solution]") && e.solution) {
			$(".py-actions [data-py-reset]")?.insertAdjacentHTML("beforebegin", `<button class="bouton" data-py-solution>Solution</button>`);
		}
	} catch (err) {
		pyAfficher({ ok: false, message: err.message }, e, false);
	} finally {
		document.querySelectorAll("[data-py-run]").forEach((b) => (b.disabled = false));
	}
}

// Insertion au curseur (touches absentes du clavier iPad/iPhone)
function pyInserer(ta, txt) {
	const a = ta.selectionStart, b = ta.selectionEnd;
	ta.setRangeText(txt, a, b, "end");
	ta.focus();
	ta.dispatchEvent(new Event("input", { bubbles: true }));
}

document.addEventListener("click", (ev) => {
	const t = ev.target.closest("[data-py-ouvrir],[data-py-liste],[data-py-run],[data-py-ins],[data-py-indice],[data-py-solution],[data-py-reset],[data-py-module]");
	if (!t) return;
	ev.preventDefault();
	const d = t.dataset;
	if ("pyModule" in d) { R.ouvert = "__python"; R.pyEx = null; R.session = null; rendre(); window.scrollTo(0, 0); pyCharger().then(() => R.ouvert === "__python" && rendre()); pyDemarrer().catch(() => {}); return; }
	if (d.pyOuvrir) { R.pyEx = d.pyOuvrir; rendre(); window.scrollTo(0, 0); return; }
	if ("pyListe" in d) { R.pyEx = null; rendre(); window.scrollTo(0, 0); return; }
	if (d.pyRun) { pyLancer(d.pyRun === "verif"); return; }
	if (d.pyIns != null) { const ta = $("#py-code"); if (ta) pyInserer(ta, d.pyIns); return; }
	const e = pyEx($("#py-code")?.dataset.pyId);
	if ("pyIndice" in d && e) {
		const z = $("#py-indices"), n = z.children.length;
		if (n < e.indices.length) { z.insertAdjacentHTML("beforeend", `<div class="r-indice">💡 ${inline(h(e.indices[n]))}</div>`); formules(z); }
		if (n + 1 >= e.indices.length) t.disabled = true;
		return;
	}
	if ("pySolution" in d && e) {
		const z = $("#py-indices");
		z.insertAdjacentHTML("beforeend", `<div class="py-bloc-t">Solution</div><pre class="py-console py-sol">${h(e.solution)}</pre><button class="bouton petit-b" data-py-ins-sol>Copier dans l'éditeur</button>`);
		t.disabled = true;
		return;
	}
	if ("pyReset" in d && e) { const ta = $("#py-code"); ta.value = e.depart; ta.dispatchEvent(new Event("input", { bubbles: true })); $("#py-sortie").hidden = true; }
});
document.addEventListener("click", (ev) => {
	if (!ev.target.closest("[data-py-ins-sol]")) return;
	const ta = $("#py-code"), e = pyEx(ta?.dataset.pyId);
	if (ta && e) { ta.value = e.solution; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.scrollIntoView({ block: "center" }); }
});
// Sauvegarde du code tapé + tabulation et indentation automatique
document.addEventListener("input", (ev) => {
	if (ev.target.id !== "py-code") return;
	PY.code[ev.target.dataset.pyId] = ev.target.value;
	clearTimeout(PY.tSave); PY.tSave = setTimeout(() => store.set("ae.pyCode", PY.code), 400);
});
document.addEventListener("keydown", (ev) => {
	const ta = ev.target;
	if (ta.id !== "py-code") return;
	if (ev.key === "Tab") { ev.preventDefault(); pyInserer(ta, "    "); return; }
	if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); pyLancer(true); return; }
	if (ev.key === "Enter" && !ev.shiftKey) {
		ev.preventDefault();
		const avant = ta.value.slice(0, ta.selectionStart), ligne = avant.split("\n").pop();
		let ind = (ligne.match(/^\s*/) || [""])[0];
		if (/:\s*(#.*)?$/.test(ligne)) ind += "    ";
		pyInserer(ta, "\n" + ind);
	}
});
