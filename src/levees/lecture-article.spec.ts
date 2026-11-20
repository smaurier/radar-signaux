import { validerLectures } from './lecture-article';

/**
 * Le fichier de lectures est ecrit par un modele qui a lu des pages web : il
 * est traite comme une entree non fiable. Tout ce qui sort du contrat est
 * rejete, jamais stocke.
 */
describe('validerLectures', () => {
  const A = 'https://www.maddyness.com/2026/11/10/article-a/';
  const B = 'https://www.maddyness.com/2026/11/13/article-b/';
  const demandes = new Set([A, B]);

  const levee = {
    nom: 'Kestrel',
    montant: 4_000_000,
    devise: 'EUR',
    recrutement: true,
    resumeRecrutement: 'Renforcer les équipes produit et ingénierie.',
  };

  it("accepte la lecture d'une levee", () => {
    const resultat = validerLectures(
      [{ url: A, genre: 'levee', levees: [levee] }],
      demandes,
    );

    expect(resultat.rejets).toEqual([]);
    expect(resultat.valides).toEqual([
      { url: A, genre: 'levee', levees: [levee] },
    ]);
  });

  it('accepte un recapitulatif qui contient plusieurs levees', () => {
    const resultat = validerLectures(
      [
        {
          url: A,
          genre: 'recap',
          levees: [
            levee,
            {
              nom: 'Orbis',
              montant: null,
              devise: null,
              recrutement: false,
              resumeRecrutement: null,
            },
          ],
        },
      ],
      demandes,
    );

    expect(resultat.valides[0].levees).toHaveLength(2);
  });

  it("accepte un article qui n'annonce aucune levee", () => {
    const resultat = validerLectures(
      [{ url: A, genre: 'sans_levee', levees: [] }],
      demandes,
    );

    expect(resultat.valides).toHaveLength(1);
  });

  it("rejette un article qui n'etait pas demande : une page piegee ne peut pas faire ecrire ailleurs", () => {
    const resultat = validerLectures(
      [
        {
          url: 'https://exemple.fr/autre/',
          genre: 'levee',
          levees: [levee],
        },
      ],
      demandes,
    );

    expect(resultat.valides).toEqual([]);
    expect(resultat.rejets).toEqual([
      { url: 'https://exemple.fr/autre/', raison: 'article non demandé' },
    ]);
  });

  it('rejette un champ inconnu : rien ne doit pouvoir se glisser hors du contrat', () => {
    const resultat = validerLectures(
      [{ url: A, genre: 'levee', levees: [{ ...levee, texte: '...' }] }],
      demandes,
    );

    expect(resultat.valides).toEqual([]);
    expect(resultat.rejets[0].url).toBe(A);
  });

  it("rejette un resume de plus de 200 caracteres : on reformule, on ne recopie pas l'article", () => {
    const resultat = validerLectures(
      [
        {
          url: A,
          genre: 'levee',
          levees: [{ ...levee, resumeRecrutement: 'x'.repeat(201) }],
        },
      ],
      demandes,
    );

    expect(resultat.valides).toEqual([]);
  });

  it.each([
    ['un montant sans devise', { ...levee, devise: null }],
    ['une devise sans montant', { ...levee, montant: null }],
    ['un montant negatif', { ...levee, montant: -1 }],
    ['un nom vide', { ...levee, nom: '  ' }],
  ])('rejette %s', (_cas, leveeInvalide) => {
    expect(
      validerLectures(
        [{ url: A, genre: 'levee', levees: [leveeInvalide] }],
        demandes,
      ).valides,
    ).toEqual([]);
  });

  it.each([
    ['une levee sans aucune levee', { url: A, genre: 'levee', levees: [] }],
    [
      'un article sans levee qui en liste une',
      { url: A, genre: 'sans_levee', levees: [levee] },
    ],
  ])('rejette %s', (_cas, lecture) => {
    expect(validerLectures([lecture], demandes).valides).toEqual([]);
  });

  it("une lecture invalide n'empeche pas d'enregistrer les autres", () => {
    const resultat = validerLectures(
      [
        { url: A, genre: 'inconnu', levees: [] },
        { url: B, genre: 'sans_levee', levees: [] },
      ],
      demandes,
    );

    expect(resultat.valides.map((l) => l.url)).toEqual([B]);
    expect(resultat.rejets.map((r) => r.url)).toEqual([A]);
  });

  it('ne garde que la premiere lecture d’un meme article', () => {
    const resultat = validerLectures(
      [
        { url: A, genre: 'sans_levee', levees: [] },
        { url: A, genre: 'levee', levees: [levee] },
      ],
      demandes,
    );

    expect(resultat.valides).toEqual([
      { url: A, genre: 'sans_levee', levees: [] },
    ]);
    expect(resultat.rejets).toEqual([
      { url: A, raison: 'article lu deux fois' },
    ]);
  });

  it("rejette tout si le fichier n'est pas une liste", () => {
    expect(validerLectures({ url: A }, demandes)).toEqual({
      valides: [],
      rejets: [{ url: null, raison: "le fichier n'est pas une liste" }],
    });
  });
});
