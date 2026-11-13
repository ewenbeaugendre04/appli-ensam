// Python dans le navigateur (Pyodide), dans un Worker : l'interface ne gèle jamais et une boucle infinie peut être arrêtée.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pret = null;

const HARNAIS = `
import sys, io, json, traceback, base64, os
os.environ["MPLBACKEND"] = "AGG"
sys.path.insert(0, "/home/pyodide")

def __executer(code, prepa, test, verifier_aussi):
    import simu
    ns = {"__name__": "__main__"}
    out = io.StringIO()
    res = {"sortie": "", "erreur": None, "tests": [], "images": []}
    ancien = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    try:
        simu._etat.update({"debut": False})
        if prepa:
            exec(prepa, ns)
        try:
            exec(compile(code, "<ton code>", "exec"), ns)
        except SyntaxError as e:
            res["erreur"] = {"type": type(e).__name__, "message": e.msg, "ligne": e.lineno}
        except Exception as e:
            tb = traceback.extract_tb(e.__traceback__)
            ligne = next((f.lineno for f in reversed(tb) if f.filename == "<ton code>"), None)
            res["erreur"] = {"type": type(e).__name__, "message": str(e), "ligne": ligne}
        if verifier_aussi and test and not res["erreur"]:
            resultats = []
            def verifier(cond, ok, ko):
                resultats.append({"ok": bool(cond), "msg": ok if cond else ko})
            ns["verifier"] = verifier
            ns["_sortie"] = out.getvalue()
            try:
                exec(test, ns)
            except Exception as e:
                resultats.append({"ok": False, "msg": "Vérification impossible : " + type(e).__name__ + " : " + str(e) + " (une variable demandée manque peut-être)"})
            res["tests"] = resultats
    finally:
        sys.stdout, sys.stderr = ancien
    res["sortie"] = out.getvalue()
    if "matplotlib.pyplot" in sys.modules:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            res["images"].append(base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    return json.dumps(res)
`;

const PAQUETS = {
	"code_aster/__init__.py": "import simu\nfrom simu import AsterError\nclass CA:\n    @staticmethod\n    def init(*a, **k):\n        simu.DEBUT()\n",
	"code_aster/Commands.py": "from simu import COMMANDES\nglobals().update(COMMANDES)\n__all__ = list(COMMANDES)\n",
	"salome/__init__.py": "def salome_init(*a, **k):\n    print('   -- salome_init : session Salome ouverte --')\n",
	"salome/geom/__init__.py": "",
	"salome/geom/geomBuilder.py": "from simu import GeomBuilder\ndef New(*a, **k):\n    return GeomBuilder()\n",
};

async function initialiser(simuUrl) {
	importScripts(PYODIDE + "pyodide.js");
	const py = await loadPyodide({ indexURL: PYODIDE });
	const simu = await (await fetch(simuUrl)).text();
	py.FS.mkdirTree("/home/pyodide/code_aster");
	py.FS.mkdirTree("/home/pyodide/salome/geom");
	py.FS.writeFile("/home/pyodide/simu.py", simu);
	for (const [f, c] of Object.entries(PAQUETS)) py.FS.writeFile("/home/pyodide/" + f, c);
	await py.runPythonAsync(HARNAIS);
	return py;
}

self.onmessage = async (e) => {
	const { id, type, code, prepa, test, verifier, simuUrl } = e.data;
	try {
		if (!pret) pret = initialiser(simuUrl);
		const py = await pret;
		if (type === "init") { self.postMessage({ id, ok: true }); return; }
		// charge numpy / matplotlib seulement si le code les importe
		await py.loadPackagesFromImports((prepa || "") + "\n" + code + "\n" + (test || ""));
		const f = py.globals.get("__executer");
		const r = f(code, prepa || "", test || "", !!verifier);
		f.destroy();
		self.postMessage({ id, ok: true, resultat: JSON.parse(r) });
	} catch (err) {
		self.postMessage({ id, ok: false, message: String(err && err.message || err) });
	}
};
