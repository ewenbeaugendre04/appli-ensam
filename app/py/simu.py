# -*- coding: utf-8 -*-
"""
Simulation pédagogique de Salome-Meca (GEOM, SMESH), de Code_Aster et d'un solveur fluide,
pour s'entraîner dans le navigateur. Mêmes noms de commandes et de mots-clés que les vrais logiciels,
contrôle des erreurs courantes, et résultats analytiques (barre, poutre, écoulement de Poiseuille)
à la place d'un vrai calcul par éléments finis / volumes finis.
"""
import math

# ======================================================================
#  Maillages connus de LIRE_MAILLAGE
#  Une pièce = un parallélépipède : L selon X, h selon Y, b selon Z.
#  Groupes de faces : position "x0", "xL", "y0", "yL", "z0", "zL" ; "volume" ; "noeud_xL"
# ======================================================================
MAILLAGES = {
    "barre": dict(type="boite", L=100.0, h=10.0, b=10.0,
                  groupes={"BARRE": "volume", "ENCAS": "x0", "CHARGE": "xL", "P_ENCAS": "noeud_x0", "P_BOUT": "noeud_xL"},
                  description="Barre 100 × 10 × 10 mm selon X. Volume BARRE, face ENCAS en x = 0, face CHARGE en x = 100."),
    "console": dict(type="boite", L=500.0, h=40.0, b=20.0,
                    groupes={"POUTRE": "volume", "ENCAS": "x0", "BOUT": "xL", "P_BOUT": "noeud_xL"},
                    description="Poutre 500 × 40 (selon Y) × 20 mm. Volume POUTRE, face ENCAS en x = 0, face BOUT en x = 500."),
}
_etat = {"maillage": "barre", "debut": False, "unites": {}, "fichiers": {}}

def preparer(maillage="barre", unite=20):
    """Associe un maillage à l'unité logique (comme le fichier .med déclaré dans l'étude)."""
    _etat["unites"][unite] = maillage
    _etat["maillage"] = maillage
    _etat["debut"] = False

class AsterError(Exception):
    """Erreur façon Code_Aster (<F> = erreur fatale)."""

def _F(**kw):
    return dict(kw)

def _liste(x):
    if x is None: return []
    if isinstance(x, dict): return [x]
    if isinstance(x, (list, tuple)): return list(x)
    return [x]

def _exige(kw, cles, commande):
    manque = [c for c in cles if c not in kw]
    if manque:
        raise AsterError(f"<F> {commande} : mot-clé obligatoire absent : {', '.join(manque)}")

def _groupes(kw):
    g = kw.get("GROUP_MA", kw.get("GROUP_NO"))
    if g is None: return []
    return [g] if isinstance(g, str) else list(g)

def _verifie_groupes(maillage, groupes, commande):
    connus = list(MAILLAGES[maillage.nom]["groupes"])
    for g in groupes:
        if g not in connus:
            raise AsterError(f"<F> {commande} : le groupe '{g}' n'existe pas dans le maillage. Groupes disponibles : {', '.join(connus)}")

def _pos(maillage, g):
    return MAILLAGES[maillage.nom]["groupes"].get(g, "")

# ======================================================================
#  Objets Code_Aster
# ======================================================================
class Maillage:
    def __init__(self, nom): self.nom = nom
    def __repr__(self): return f"<Maillage {self.nom} : {MAILLAGES[self.nom]['description']}>"
    def getGroupsOfCells(self): return [g for g, p in MAILLAGES[self.nom]["groupes"].items() if not p.startswith("noeud")]
    def getGroupsOfNodes(self): return list(MAILLAGES[self.nom]["groupes"])

class Modele:
    def __init__(self, maillage, modelisation, phenomene): self.maillage, self.modelisation, self.phenomene = maillage, modelisation, phenomene
    def __repr__(self): return f"<Modele {self.phenomene} {self.modelisation}>"

class Materiau:
    def __init__(self, E, NU, RHO=None): self.E, self.NU, self.RHO = E, NU, RHO
    def __repr__(self): return f"<Materiau E={self.E} NU={self.NU}>"

class ChampMater:
    def __init__(self, maillage, affectations): self.maillage, self.affectations = maillage, affectations
    def materiau(self): return self.affectations[0][1]

class Chargement:
    def __init__(self, modele, blocages, forces): self.modele, self.blocages, self.forces = modele, blocages, forces
    def __repr__(self): return f"<Chargement : {len(self.blocages)} blocage(s), {len(self.forces)} effort(s)>"

class Fonction:
    def __init__(self, para, x, y): self.para, self.x, self.y = para, x, y
    def __call__(self, t):
        x, y = self.x, self.y
        if t <= x[0]: return y[0]
        for i in range(1, len(x)):
            if t <= x[i]: return y[i - 1] + (y[i] - y[i - 1]) * (t - x[i - 1]) / (x[i] - x[i - 1])
        return y[-1]
    def __repr__(self): return f"<Fonction de {self.para} : {len(self.x)} points>"

class ListeReels(list):
    pass

class Champ:
    """Champ aux nœuds (sur l'axe de la pièce) : valeurs nœud par nœud, composante par composante."""
    def __init__(self, nom, composantes, valeurs, x):
        self.nom, self.composantes, self._v, self.x = nom, composantes, valeurs, x
    def getValues(self): return [v for noeud in self._v for v in noeud]
    def getComponents(self): return list(self.composantes)
    def getValuesWithDescription(self, composante):
        if composante not in self.composantes:
            raise AsterError(f"<F> composante {composante} absente du champ {self.nom} (composantes : {', '.join(self.composantes)})")
        i = self.composantes.index(composante)
        return [n[i] for n in self._v], list(range(1, len(self._v) + 1))
    def toSimpleFieldOnNodes(self): return self
    def __repr__(self): return f"<Champ {self.nom} : {len(self._v)} nœuds × {self.composantes}>"

class Resultat:
    def __init__(self, maillage, champs, inst=(1.0,)):
        self.maillage, self._champs, self._inst = maillage, champs, list(inst)
    def getField(self, nom, para=1):
        if nom not in self._champs:
            raise AsterError(f"<F> le champ {nom} n'existe pas dans le résultat. Champs calculés : {', '.join(self._champs)}. (Contraintes et réactions se calculent avec CALC_CHAMP.)")
        return self._champs[nom]
    def getFieldNames(self): return list(self._champs)
    def getAccessParameters(self): return {"NUME_ORDRE": list(range(1, len(self._inst) + 1)), "INST": self._inst}
    def __repr__(self): return f"<Resultat : champs {', '.join(self._champs)}>"

class Table:
    def __init__(self, colonnes): self._c = colonnes
    def EXTR_TABLE(self): return self
    def values(self): return {k: list(v) for k, v in self._c.items()}
    def __repr__(self):
        return "\n".join(f"{k:>10} : {v}" for k, v in self._c.items())

# ======================================================================
#  Commandes Code_Aster
# ======================================================================
def DEBUT(**kw):
    _etat["debut"] = True
    print("   -- DEBUT : début de l'étude --")

def FIN(**kw):
    print("   -- FIN : fin de l'étude --")

def LIRE_MAILLAGE(**kw):
    if not _etat["debut"]: raise AsterError("<F> Il faut appeler DEBUT() avant toute commande.")
    unite = kw.get("UNITE", 20)
    nom = _etat["unites"].get(unite)
    if nom is None: raise AsterError(f"<F> LIRE_MAILLAGE : aucun fichier associé à l'unité logique {unite} (dans l'étude, le maillage .med est déclaré en unité 20 par défaut).")
    if kw.get("FORMAT", "ASTER") != "MED": print("   <A> LIRE_MAILLAGE : un maillage issu de Salome se lit avec FORMAT='MED'.")
    print(f"   -- LIRE_MAILLAGE : {MAILLAGES[nom]['description']}")
    return Maillage(nom)

def AFFE_MODELE(**kw):
    _exige(kw, ["MAILLAGE", "AFFE"], "AFFE_MODELE")
    affe = _liste(kw["AFFE"])
    for a in affe:
        _exige(a, ["PHENOMENE", "MODELISATION"], "AFFE_MODELE/AFFE")
        if "TOUT" not in a and "GROUP_MA" not in a: raise AsterError("<F> AFFE_MODELE/AFFE : il faut TOUT='OUI' ou GROUP_MA.")
        if a["PHENOMENE"] != "MECANIQUE": raise AsterError(f"<F> PHENOMENE='{a['PHENOMENE']}' : ici on fait de la MECANIQUE.")
    _verifie_groupes(kw["MAILLAGE"], [g for a in affe for g in _groupes(a)], "AFFE_MODELE")
    return Modele(kw["MAILLAGE"], affe[0]["MODELISATION"], affe[0]["PHENOMENE"])

def DEFI_MATERIAU(**kw):
    if "ELAS" not in kw: raise AsterError("<F> DEFI_MATERIAU : pour un calcul élastique il faut le mot-clé facteur ELAS=_F(E=..., NU=...).")
    e = kw["ELAS"]
    if not isinstance(e, dict): raise AsterError("<F> DEFI_MATERIAU : ELAS doit être écrit ELAS=_F(E=..., NU=...).")
    _exige(e, ["E", "NU"], "DEFI_MATERIAU/ELAS")
    if not (0 <= e["NU"] < 0.5): raise AsterError(f"<F> DEFI_MATERIAU : NU={e['NU']} impossible (0 ≤ NU < 0,5).")
    if isinstance(e["E"], int): print("   <A> DEFI_MATERIAU : E est un entier. Écris plutôt un réel (210000. ou 2.1e5) : Code_Aster attend des réels.")
    return Materiau(e["E"], e["NU"], e.get("RHO"))

def AFFE_MATERIAU(**kw):
    _exige(kw, ["AFFE"], "AFFE_MATERIAU")
    if "MAILLAGE" not in kw and "MODELE" not in kw: raise AsterError("<F> AFFE_MATERIAU : il faut MAILLAGE=... (ou MODELE=...).")
    maillage = kw.get("MAILLAGE") or kw["MODELE"].maillage
    aff = []
    for a in _liste(kw["AFFE"]):
        _exige(a, ["MATER"], "AFFE_MATERIAU/AFFE")
        if "TOUT" not in a and "GROUP_MA" not in a: raise AsterError("<F> AFFE_MATERIAU/AFFE : il faut TOUT='OUI' ou GROUP_MA.")
        _verifie_groupes(maillage, _groupes(a), "AFFE_MATERIAU")
        aff.append((a.get("GROUP_MA", "TOUT"), a["MATER"]))
    return ChampMater(maillage, aff)

def AFFE_CHAR_MECA(**kw):
    _exige(kw, ["MODELE"], "AFFE_CHAR_MECA")
    mod = kw["MODELE"]
    blocs, forces = [], []
    for d in _liste(kw.get("DDL_IMPO")):
        g = _groupes(d)
        if not g: raise AsterError("<F> DDL_IMPO : précise GROUP_MA (ou GROUP_NO) : sur quoi bloques-tu ?")
        _verifie_groupes(mod.maillage, g, "AFFE_CHAR_MECA/DDL_IMPO")
        ddl = {k: v for k, v in d.items() if k in ("DX", "DY", "DZ", "DRX", "DRY", "DRZ")}
        if not ddl: raise AsterError("<F> DDL_IMPO : indique au moins un degré de liberté (DX=0., DY=0., DZ=0.).")
        blocs.append((g, ddl))
    for nom in ("FORCE_FACE", "PRES_REP", "FORCE_NODALE"):
        for f in _liste(kw.get(nom)):
            g = _groupes(f)
            if not g: raise AsterError(f"<F> {nom} : précise GROUP_MA (ou GROUP_NO) : sur quoi appliques-tu l'effort ?")
            _verifie_groupes(mod.maillage, g, f"AFFE_CHAR_MECA/{nom}")
            for gg in g:
                p = _pos(mod.maillage, gg)
                if nom == "FORCE_NODALE" and not p.startswith("noeud"): raise AsterError(f"<F> FORCE_NODALE s'applique sur un groupe de NŒUDS (GROUP_NO), pas sur la face '{gg}'. Pour une face, utilise FORCE_FACE.")
                if nom != "FORCE_NODALE" and (p.startswith("noeud") or p == "volume"): raise AsterError(f"<F> {nom} s'applique sur une FACE (GROUP_MA de faces), pas sur '{gg}'.")
            if not any(k in f for k in ("FX", "FY", "FZ", "PRES")): raise AsterError(f"<F> {nom} : aucune composante d'effort (FX, FY, FZ ou PRES).")
            forces.append((nom, g, f))
    if not blocs and not forces: raise AsterError("<F> AFFE_CHAR_MECA : aucun chargement ni blocage défini.")
    return Chargement(mod, blocs, forces)

def DEFI_FONCTION(**kw):
    _exige(kw, ["NOM_PARA", "VALE"], "DEFI_FONCTION")
    v = list(kw["VALE"])
    if len(v) % 2: raise AsterError("<F> DEFI_FONCTION : VALE doit contenir des couples (x1, y1, x2, y2, ...) : nombre pair de valeurs.")
    x, y = v[0::2], v[1::2]
    if any(b <= a for a, b in zip(x, x[1:])): raise AsterError("<F> DEFI_FONCTION : les abscisses doivent être strictement croissantes.")
    return Fonction(kw["NOM_PARA"], x, y)

def DEFI_LIST_REEL(**kw):
    _exige(kw, ["DEBUT"], "DEFI_LIST_REEL")
    l = ListeReels([kw["DEBUT"]])
    for i in _liste(kw.get("INTERVALLE")):
        _exige(i, ["JUSQU_A"], "DEFI_LIST_REEL/INTERVALLE")
        a, b = l[-1], i["JUSQU_A"]
        n = i.get("NOMBRE") or round((b - a) / i["PAS"])
        l += [a + (b - a) * k / n for k in range(1, n + 1)]
    return l

def MECA_STATIQUE(**kw):
    _exige(kw, ["MODELE", "CHAM_MATER", "EXCIT"], "MECA_STATIQUE")
    mod, cm = kw["MODELE"], kw["CHAM_MATER"]
    charges = [e.get("CHARGE") for e in _liste(kw["EXCIT"])]
    if None in charges: raise AsterError("<F> MECA_STATIQUE/EXCIT : chaque occurrence doit contenir CHARGE=...")
    m = MAILLAGES[mod.maillage.nom]
    mail = mod.maillage
    if mod.modelisation not in ("3D", "D_PLAN", "C_PLAN", "POU_D_E", "POU_D_T"):
        raise AsterError(f"<F> MODELISATION='{mod.modelisation}' inconnue.")
    # --- blocages : un encastrement en x = 0, et éventuellement un déplacement imposé en x = L
    encastre, delta = False, None
    for c in charges:
        for g, d in c.blocages:
            for gg in g:
                p = _pos(mail, gg)
                if p in ("x0", "noeud_x0"):
                    if all(d.get(k, None) == 0 for k in ("DX", "DY", "DZ")): encastre = True
                    elif d.get("DX", None) == 0: encastre = True; print("   <A> seul DX est bloqué sur la face d'encastrement : la pièce peut glisser en Y et Z (ici la simulation l'accepte, Code_Aster refuserait peut-être).")
                elif p in ("xL", "noeud_xL") and d.get("DX", 0) != 0:
                    delta = d["DX"]
    if not encastre:
        raise AsterError("<F> MECA_STATIQUE : la matrice de rigidité est singulière : la structure n'est pas bloquée (mouvement de corps rigide). Bloque la face en x = 0 avec DDL_IMPO (DX=0., DY=0., DZ=0.).")
    mat = cm.materiau()
    E, NU = mat.E, mat.NU
    if E < 1e3: print(f"   <A> E = {E} semble très petit : vérifie tes unités (MPa avec un maillage en mm).")
    L, h, b = m["L"], m["h"], m["b"]
    S, I = b * h, b * h ** 3 / 12
    Fx = Fy = 0.0
    for c in charges:
        for nom, g, f in c.forces:
            for gg in g:
                p = _pos(mail, gg)
                if p in ("x0", "noeud_x0"):
                    print(f"   <A> effort sur '{gg}', qui est encastré : il part directement dans l'appui (aucun effet sur la pièce)."); continue
                if p not in ("xL", "noeud_xL"):
                    raise AsterError(f"<F> (simulation) l'effort sur '{gg}' n'est pas en bout de pièce : seuls les efforts sur la face en x = L sont simulés ici.")
                if nom == "FORCE_FACE": Fx += f.get("FX", 0.0) * S; Fy += f.get("FY", 0.0) * S
                elif nom == "PRES_REP": Fx += -f.get("PRES", 0.0) * S
                else: Fx += f.get("FX", 0.0); Fy += f.get("FY", 0.0)
    if delta is not None and Fx != 0:
        raise AsterError("<F> (simulation) déplacement imposé ET effort selon X sur la même face : choisis l'un ou l'autre.")
    n = 11
    xs = [L * i / (n - 1) for i in range(n)]
    if delta is not None: Fx = E * S * delta / L
    depl = [[Fx * x / (E * S), Fy * x * x * (3 * L - x) / (6 * E * I), 0.0] for x in xs]
    res = Resultat(mail, {"DEPL": Champ("DEPL", ["DX", "DY", "DZ"], depl, xs)})
    res._donnees = dict(Fx=Fx, Fy=Fy, E=E, NU=NU, S=S, I=I, L=L, xs=xs, h=h)
    print(f"   -- MECA_STATIQUE : calcul élastique linéaire terminé ({n} nœuds relevés sur l'axe) --")
    return res

def CALC_CHAMP(**kw):
    _exige(kw, ["RESULTAT"], "CALC_CHAMP")
    r = kw["RESULTAT"]
    d = getattr(r, "_donnees", None)
    if d is None: raise AsterError("<F> CALC_CHAMP : RESULTAT doit être issu de MECA_STATIQUE.")
    demandes = [c for k in ("CONTRAINTE", "CRITERES", "DEFORMATION", "FORCE") for c in _liste(kw.get(k))]
    if not demandes: raise AsterError("<F> CALC_CHAMP : rien à calculer. Exemple : CONTRAINTE=('SIGM_NOEU',), CRITERES=('SIEQ_NOEU',), FORCE=('REAC_NODA',).")
    sig = [d["Fx"] / d["S"] + d["Fy"] * (d["L"] - x) * (d["h"] / 2) / d["I"] for x in d["xs"]]
    for c in demandes:
        if c in ("SIGM_NOEU", "SIGM_ELNO"):
            r._champs[c] = Champ(c, ["SIXX", "SIYY", "SIZZ", "SIXY", "SIXZ", "SIYZ"], [[s, 0, 0, 0, 0, 0] for s in sig], d["xs"])
        elif c in ("SIEQ_NOEU", "SIEQ_ELNO"):
            r._champs[c] = Champ(c, ["VMIS", "TRESCA"], [[abs(s), abs(s)] for s in sig], d["xs"])
        elif c in ("EPSI_NOEU", "EPSI_ELNO"):
            r._champs[c] = Champ(c, ["EPXX"], [[s / d["E"]] for s in sig], d["xs"])
        elif c == "REAC_NODA":
            reac = [[0.0, 0.0, 0.0] for _ in d["xs"]]
            reac[0] = [-d["Fx"], -d["Fy"], 0.0]
            r._champs[c] = Champ(c, ["DX", "DY", "DZ"], reac, d["xs"])
        else:
            raise AsterError(f"<F> CALC_CHAMP : option {c} inconnue ici (essaie SIGM_NOEU, SIEQ_NOEU, EPSI_NOEU, REAC_NODA).")
    print(f"   -- CALC_CHAMP : {', '.join(demandes)} calculé(s) --")
    return r

def POST_RELEVE_T(**kw):
    _exige(kw, ["ACTION"], "POST_RELEVE_T")
    a = _liste(kw["ACTION"])[0]
    _exige(a, ["INTITULE", "RESULTAT", "NOM_CHAM", "OPERATION"], "POST_RELEVE_T/ACTION")
    r = a["RESULTAT"]
    if a["NOM_CHAM"] not in r.getFieldNames():
        raise AsterError(f"<F> POST_RELEVE_T : le champ {a['NOM_CHAM']} n'a pas été calculé (pour les réactions : CALC_CHAMP(..., FORCE=('REAC_NODA',))).")
    g = _groupes(a)
    if not g: raise AsterError("<F> POST_RELEVE_T : précise GROUP_NO (le groupe où relever).")
    _verifie_groupes(r.maillage, g, "POST_RELEVE_T")
    champ = r.getField(a["NOM_CHAM"])
    cmps = list(_liste(a.get("RESULTANTE")) or _liste(a.get("NOM_CMP")))
    if not cmps: raise AsterError("<F> POST_RELEVE_T : indique RESULTANTE=('DX',) (somme sur le groupe) ou NOM_CMP.")
    p = _pos(r.maillage, g[0])
    i = 0 if p in ("x0", "noeud_x0") else -1
    col = {"INTITULE": [a["INTITULE"]], "GROUP_NO": [g[0]]}
    for c in cmps:
        vals = champ.getValuesWithDescription(c)[0]
        col[c] = [vals[i]]
    t = Table(col)
    print(f"   -- POST_RELEVE_T : table '{a['INTITULE']}' créée --")
    return t

def IMPR_RESU(**kw):
    _exige(kw, ["RESU"], "IMPR_RESU")
    print(f"   -- IMPR_RESU : résultats écrits au format {kw.get('FORMAT', 'RESULTAT')} (à ouvrir dans ParaVis) --")

COMMANDES = dict(DEBUT=DEBUT, FIN=FIN, LIRE_MAILLAGE=LIRE_MAILLAGE, AFFE_MODELE=AFFE_MODELE, DEFI_MATERIAU=DEFI_MATERIAU,
                 AFFE_MATERIAU=AFFE_MATERIAU, AFFE_CHAR_MECA=AFFE_CHAR_MECA, MECA_STATIQUE=MECA_STATIQUE, CALC_CHAMP=CALC_CHAMP,
                 POST_RELEVE_T=POST_RELEVE_T, IMPR_RESU=IMPR_RESU, DEFI_FONCTION=DEFI_FONCTION, DEFI_LIST_REEL=DEFI_LIST_REEL, _F=_F)

# ======================================================================
#  Salome GEOM (sous-ensemble)
# ======================================================================
ShapeType = {"COMPOUND": 0, "COMPSOLID": 1, "SOLID": 2, "SHELL": 3, "FACE": 4, "WIRE": 5, "EDGE": 6, "VERTEX": 7, "SHAPE": 8}
_NOMS_TYPES = {v: k for k, v in ShapeType.items()}

class Forme:
    _n = 0
    def __init__(self, nom, volume=0.0, surface=None, cdg=(0, 0, 0), genre="SOLID", longueur=0.0, geo=None):
        Forme._n += 1
        self.id, self.nom, self.volume, self.surface, self.cdg, self.genre, self.longueur, self.geo = Forme._n, nom, volume, surface, cdg, genre, longueur, geo or {}
        self.pere, self.sous = None, []
    def GetShapeType(self): return self.genre
    def __repr__(self): return f"<GEOM_Object {self.nom} ({self.genre})>"

class Groupe(Forme):
    def __init__(self, pere, genre):
        super().__init__("Groupe", genre=genre)
        self.pere, self.elements = pere, []
    def __repr__(self): return f"<Groupe {self.nom} : {len(self.elements)} {self.genre.lower()}(s)>"

class GeomBuilder:
    ShapeType = ShapeType
    def MakeVertex(self, x, y, z):
        return Forme("Vertex", cdg=(x, y, z), genre="VERTEX")
    def MakeVectorDXDYDZ(self, dx, dy, dz):
        n = math.sqrt(dx * dx + dy * dy + dz * dz)
        if n == 0: raise ValueError("MakeVectorDXDYDZ : vecteur nul")
        return Forme("Vector", genre="EDGE", longueur=n, geo={"dir": (dx, dy, dz)})
    def MakeLineTwoPnt(self, p1, p2):
        (a, b, c), (d, e, f) = p1.cdg, p2.cdg
        L = math.dist((a, b, c), (d, e, f))
        if L == 0: raise ValueError("MakeLineTwoPnt : les deux points sont confondus")
        return Forme("Line", genre="EDGE", longueur=L, cdg=((a + d) / 2, (b + e) / 2, (c + f) / 2))
    def MakeBoxDXDYDZ(self, dx, dy, dz):
        for v in (dx, dy, dz):
            if v <= 0: raise ValueError("MakeBoxDXDYDZ : les dimensions doivent être > 0")
        return Forme("Box", dx * dy * dz, 2 * (dx * dy + dy * dz + dx * dz), (dx / 2, dy / 2, dz / 2), geo={"type": "boite", "dx": dx, "dy": dy, "dz": dz, "o": (0, 0, 0)})
    def MakeBox(self, x1, y1, z1, x2, y2, z2):
        f = self.MakeBoxDXDYDZ(x2 - x1, y2 - y1, z2 - z1)
        f.geo["o"] = (x1, y1, z1); f.cdg = ((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2)
        return f
    def MakeCylinderRH(self, r, h):
        if r <= 0 or h <= 0: raise ValueError("MakeCylinderRH : rayon et hauteur > 0")
        return Forme("Cylinder", math.pi * r * r * h, 2 * math.pi * r * (r + h), (0, 0, h / 2), geo={"type": "cylindre", "r": r, "h": h, "o": (0, 0, 0)})
    def MakeSphereR(self, r):
        return Forme("Sphere", 4 / 3 * math.pi * r ** 3, 4 * math.pi * r * r)
    def MakeTranslation(self, forme, dx, dy, dz):
        x, y, z = forme.cdg
        g = dict(forme.geo)
        if "o" in g: g["o"] = (g["o"][0] + dx, g["o"][1] + dy, g["o"][2] + dz)
        return Forme(forme.nom + "_trans", forme.volume, forme.surface, (x + dx, y + dy, z + dz), forme.genre, forme.longueur, g)
    def MakeCut(self, a, b):
        if b.volume >= a.volume: raise ValueError("MakeCut : l'outil enlève toute la pièce")
        g = dict(a.geo); g["trous"] = g.get("trous", 0) + 1
        return Forme("Cut", a.volume - b.volume, None, a.cdg, geo=g)
    def MakeFuse(self, a, b):
        return Forme("Fuse", a.volume + b.volume)
    def BasicProperties(self, forme):
        return (forme.longueur, forme.surface if forme.surface is not None else float("nan"), forme.volume)
    def MakeCDG(self, forme):
        return Forme("CDG", genre="VERTEX", cdg=tuple(forme.cdg))
    def PointCoordinates(self, p):
        return tuple(p.cdg)
    def _faces(self, forme):
        g = forme.geo
        if forme.sous: return forme.sous
        if g.get("type") == "boite":
            ox, oy, oz = g["o"]; dx, dy, dz = g["dx"], g["dy"], g["dz"]
            defs = [("x0", (ox, oy + dy / 2, oz + dz / 2), dy * dz), ("xL", (ox + dx, oy + dy / 2, oz + dz / 2), dy * dz),
                    ("y0", (ox + dx / 2, oy, oz + dz / 2), dx * dz), ("yL", (ox + dx / 2, oy + dy, oz + dz / 2), dx * dz),
                    ("z0", (ox + dx / 2, oy + dy / 2, oz), dx * dy), ("zL", (ox + dx / 2, oy + dy / 2, oz + dz), dx * dy)]
        elif g.get("type") == "cylindre":
            ox, oy, oz = g["o"]; r, h = g["r"], g["h"]
            defs = [("z0", (ox, oy, oz), math.pi * r * r), ("lat", (ox, oy, oz + h / 2), 2 * math.pi * r * h), ("zL", (ox, oy, oz + h), math.pi * r * r)]
        else:
            raise ValueError("(simulation) l'exploration des faces n'est simulée que pour une boîte ou un cylindre non percés")
        forme.sous = []
        for pos, c, aire in defs:
            f = Forme("Face", genre="FACE", cdg=c, surface=aire, geo={"pos": pos})
            f.pere = forme
            forme.sous.append(f)
        return forme.sous
    def SubShapeAllSortedCentres(self, forme, genre):
        if _NOMS_TYPES.get(genre) != "FACE": raise ValueError("(simulation) seules les FACES sont explorables ici : geompy.ShapeType['FACE']")
        return sorted(self._faces(forme), key=lambda f: (round(f.cdg[0], 9), round(f.cdg[1], 9), round(f.cdg[2], 9)))
    def ExtractShapes(self, forme, genre, trier=True):
        return self.SubShapeAllSortedCentres(forme, genre)
    def GetSubShapeID(self, forme, sous):
        return self._faces(forme).index(sous) + 1
    def CreateGroup(self, forme, genre):
        if _NOMS_TYPES.get(genre) not in ("FACE", "SOLID", "EDGE", "VERTEX"): raise ValueError("CreateGroup : type de groupe inconnu, utilise geompy.ShapeType['FACE']")
        return Groupe(forme, _NOMS_TYPES[genre])
    def AddObject(self, groupe, ident):
        f = self._faces(groupe.pere)[ident - 1]
        groupe.elements.append(f)
    def UnionList(self, groupe, liste):
        for f in liste:
            if f.pere is not groupe.pere: raise ValueError("UnionList : cette face n'appartient pas à la forme du groupe")
            if f.genre != groupe.genre: raise ValueError(f"UnionList : le groupe est de type {groupe.genre}, pas {f.genre}")
            groupe.elements.append(f)
    def UnionIDs(self, groupe, ids):
        for i in ids: self.AddObject(groupe, i)
    def addToStudy(self, forme, nom):
        forme.nom = nom
        print(f"   -- objet '{nom}' ajouté à l'arbre d'étude --")
        return nom
    def addToStudyInFather(self, pere, forme, nom):
        forme.nom = nom
        print(f"   -- '{nom}' ajouté sous '{pere.nom}' --")
        return nom

# ======================================================================
#  Salome SMESH (sous-ensemble)
# ======================================================================
class _SMESHConst:
    NODE, EDGE, FACE, VOLUME = "NODE", "EDGE", "FACE", "VOLUME"
SMESH = _SMESHConst()

class _Algo:
    def __init__(self, mesh, nom): self.mesh, self.nom = mesh, nom
    def NumberOfSegments(self, n):
        if not isinstance(n, int) or n < 1: raise ValueError("NumberOfSegments : un nombre entier ≥ 1")
        self.mesh._nseg = n; return self
    def LocalLength(self, l):
        if l <= 0: raise ValueError("LocalLength : longueur > 0")
        self.mesh._taille = l; return self
    def MaxSize(self, l):
        if l <= 0: raise ValueError("MaxSize : taille > 0")
        self.mesh._taille = l; return self
    def Parameters(self): return self

class Mesh:
    def __init__(self, forme, nom="Mesh"):
        if not isinstance(forme, Forme): raise TypeError("smesh.Mesh(...) attend une forme GEOM (la pièce)")
        self.forme, self.nom = forme, nom
        self._nseg = self._taille = None
        self._algos, self._calcule, self._n = set(), False, {}
        self.groupes = {}
    def Segment(self, *a, **k): self._algos.add("1D"); return _Algo(self, "Segment")
    def Triangle(self, *a, **k): self._algos.add("2D-tri"); return _Algo(self, "Triangle")
    def Quadrangle(self, *a, **k): self._algos.add("2D-quad"); return _Algo(self, "Quadrangle")
    def Tetrahedron(self, *a, **k): self._algos.add("3D-tet"); return _Algo(self, "Tetrahedron")
    def Hexahedron(self, *a, **k): self._algos.add("3D-hex"); return _Algo(self, "Hexahedron")
    def Compute(self):
        g = self.forme.geo
        if "1D" not in self._algos and "3D-tet" not in self._algos: raise ValueError("Compute : aucun algorithme 1D (mesh.Segment()) : le maillage ne sait pas découper les arêtes.")
        if not any(a.startswith("3D") for a in self._algos): raise ValueError("Compute : aucun algorithme 3D (mesh.Hexahedron() ou mesh.Tetrahedron()) : seule la surface serait maillée, pas le volume.")
        if self._nseg is None and self._taille is None: raise ValueError("Compute : aucune taille d'éléments : algo.NumberOfSegments(n) ou algo.LocalLength(h).")
        if "3D-hex" in self._algos and "2D-quad" not in self._algos: raise ValueError("Compute : Hexahedron a besoin de Quadrangle pour mailler les faces.")
        if "3D-hex" in self._algos and g.get("type") != "boite": raise ValueError("Compute : des hexaèdres réguliers ne sont simulés ici que sur une boîte (utilise Tetrahedron sinon).")
        if g.get("type") == "boite":
            dims = (g["dx"], g["dy"], g["dz"])
            if self._nseg: n = (self._nseg,) * 3
            else: n = tuple(max(1, math.ceil(d / self._taille)) for d in dims)
        elif g.get("type") == "cylindre":
            t = self._taille or 2 * math.pi * g["r"] / (4 * self._nseg)
            n = (max(4, math.ceil(2 * math.pi * g["r"] / t)), max(1, math.ceil(g["r"] / t)), max(1, math.ceil(g["h"] / t)))
        else:
            v = self.forme.volume
            t = self._taille or v ** (1 / 3) / self._nseg
            k = max(1, round(v ** (1 / 3) / t)); n = (k, k, k)
        nx, ny, nz = n
        noeuds, hexas = (nx + 1) * (ny + 1) * (nz + 1), nx * ny * nz
        if "3D-tet" in self._algos:
            self._n = {"noeuds": noeuds, "volumes": 6 * hexas, "type": "tétraèdres"}
        else:
            self._n = {"noeuds": noeuds, "volumes": hexas, "type": "hexaèdres"}
        self._calcule = True
        print(f"   -- Compute : {self._n['noeuds']} nœuds, {self._n['volumes']} {self._n['type']} --")
        return True
    def _verifie(self):
        if not self._calcule: raise ValueError("Le maillage n'est pas encore calculé : appelle mesh.Compute() d'abord.")
    def NbNodes(self): self._verifie(); return self._n["noeuds"]
    def NbVolumes(self): self._verifie(); return self._n["volumes"]
    def NbHexas(self): self._verifie(); return self._n["volumes"] if self._n["type"] == "hexaèdres" else 0
    def NbTetras(self): self._verifie(); return self._n["volumes"] if self._n["type"] == "tétraèdres" else 0
    def GroupOnGeom(self, groupe, nom=None, typ=None):
        if not isinstance(groupe, Forme): raise TypeError("GroupOnGeom attend un groupe GEOM")
        nom = nom or groupe.nom
        if typ == SMESH.NODE:
            pos = "noeud_" + groupe.elements[0].geo["pos"] if isinstance(groupe, Groupe) and groupe.elements else "noeud"
        elif isinstance(groupe, Groupe):
            if not groupe.elements: raise ValueError(f"GroupOnGeom : le groupe GEOM '{groupe.nom}' est vide")
            pos = groupe.elements[0].geo.get("pos", "")
        else:
            pos = "volume"
        self.groupes[nom] = pos
        print(f"   -- groupe de maillage '{nom}' créé --")
        return nom
    def ExportMED(self, fichier, *a, **k):
        self._verifie()
        if not str(fichier).endswith(".med"): print("   <A> ExportMED : un fichier de maillage pour Code_Aster finit par .med")
        g = self.forme.geo
        if g.get("type") == "boite":
            MAILLAGES["export"] = dict(type="boite", L=g["dx"], h=g["dy"], b=g["dz"], groupes=dict(self.groupes, **({self.forme.nom: "volume"} if self.forme.nom not in self.groupes else {})),
                                       description=f"Maillage exporté de Salome ({g['dx']:g} × {g['dy']:g} × {g['dz']:g}), groupes : {', '.join(self.groupes) or 'aucun'}")
        elif g.get("type") == "cylindre":
            MAILLAGES["export"] = dict(type="cylindre", r=g["r"], L=g["h"], groupes=dict(self.groupes),
                                       description=f"Tuyau R = {g['r']:g}, longueur {g['h']:g}, groupes : {', '.join(self.groupes) or 'aucun'}")
        _etat["fichiers"][fichier] = "export"
        _etat["unites"][20] = "export"
        print(f"   -- ExportMED : maillage écrit dans {fichier} (unité 20 de l'étude Code_Aster) --")

class SmeshBuilder:
    def Mesh(self, forme, nom="Mesh"): return Mesh(forme, nom)

# ======================================================================
#  Solveur fluide simulé (écoulement laminaire établi dans un tuyau)
# ======================================================================
class EtudeFluide:
    def __init__(self, fichier):
        nom = _etat["fichiers"].get(fichier)
        if nom is None or MAILLAGES.get(nom, {}).get("type") != "cylindre":
            raise ValueError(f"EtudeFluide : '{fichier}' introuvable. Exporte d'abord le maillage du tuyau avec mesh.ExportMED('{fichier}').")
        self.m = MAILLAGES[nom]
        self.cl, self.rho, self.mu = {}, None, None
    def proprietes(self, rho, mu):
        if rho <= 0 or mu <= 0: raise ValueError("proprietes : rho et mu doivent être > 0 (SI : kg/m³ et Pa·s)")
        self.rho, self.mu = rho, mu
    def _groupe(self, g):
        if g not in self.m["groupes"]: raise ValueError(f"le groupe '{g}' n'existe pas dans le maillage. Groupes : {', '.join(self.m['groupes'])}")
        if g in self.cl: raise ValueError(f"le groupe '{g}' a déjà une condition aux limites ({self.cl[g][0]})")
    def entree(self, groupe, vitesse):
        self._groupe(groupe)
        if vitesse <= 0: raise ValueError("entree : la vitesse débitante doit être > 0 (en m/s)")
        self.cl[groupe] = ("entrée", vitesse)
    def sortie(self, groupe, pression=0.0):
        self._groupe(groupe); self.cl[groupe] = ("sortie", pression)
    def paroi(self, groupe):
        self._groupe(groupe); self.cl[groupe] = ("paroi", 0.0)
    def calculer(self):
        if self.rho is None: raise ValueError("calculer : propriétés du fluide manquantes : etude.proprietes(rho=..., mu=...)")
        types = [v[0] for v in self.cl.values()]
        for t in ("entrée", "sortie", "paroi"):
            if t not in types: raise ValueError(f"calculer : il manque une condition de type « {t} ».")
        faces = {"z0", "zL", "lat"}
        couvertes = {self.m["groupes"][g] for g in self.cl}
        if couvertes != faces: raise ValueError("calculer : toutes les faces du domaine doivent avoir une condition aux limites (entrée, sortie, paroi).")
        v = next(val for t, val in self.cl.values() if t == "entrée")
        ps = next(val for t, val in self.cl.values() if t == "sortie")
        R, L = self.m["r"], self.m["L"]
        D = 2 * R
        Re = self.rho * v * D / self.mu
        if Re < 2300:
            regime, dp = "laminaire", 32 * self.mu * L * v / D ** 2
        else:
            regime = "turbulent"
            f = 0.316 * Re ** -0.25
            dp = f * L / D * self.rho * v * v / 2
            print(f"   <A> Re = {Re:.0f} > 2300 : écoulement turbulent. Le profil parabolique ne s'applique plus ; perte de charge estimée avec Blasius.")
        print(f"   -- calcul fluide terminé : Re = {Re:.0f} ({regime}) --")
        return ResultatFluide(R, L, v, Re, regime, dp, ps, self.rho)

class ResultatFluide:
    def __init__(self, R, L, v, Re, regime, dp, ps, rho):
        self.R, self.L, self.v_moy, self.Re, self.regime, self.delta_p, self.p_sortie, self.rho = R, L, v, Re, regime, dp, ps, rho
        self.p_entree = ps + dp
        self.debit = v * math.pi * R * R
        self.v_max = 2 * v if regime == "laminaire" else 1.22 * v
    def vitesse(self, r):
        if abs(r) > self.R + 1e-15: raise ValueError(f"vitesse(r) : r doit être entre 0 et R = {self.R}")
        if self.regime == "laminaire": return 2 * self.v_moy * (1 - (r / self.R) ** 2)
        return 1.22 * self.v_moy * (1 - abs(r) / self.R) ** (1 / 7)
    def pression(self, z):
        return self.p_entree - self.delta_p * z / self.L
    def __repr__(self): return f"<Résultat fluide : Re={self.Re:.0f}, {self.regime}, Δp={self.delta_p:.4g} Pa>"

def installer(espace):
    """Injecte les commandes dans l'espace de noms (comme dans un fichier .comm)."""
    espace.update(COMMANDES)
