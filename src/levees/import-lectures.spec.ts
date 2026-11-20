import { Journal } from '../journal/journal';
import { ajouterAuJournal, preparerImport } from './import-lectures';

describe('preparerImport', () => {
  const A = 'https://www.maddyness.com/a/';
  const aLire = JSON.stringify([{ url: A, titre: 'Titre A' }]);

  it('compte les articles demandes, lus et les levees trouvees', () => {
    const { valides, bilan } = preparerImport(
      aLire,
      JSON.stringify([
        {
          url: A,
          genre: 'recap',
          levees: [
            {
              nom: 'Kestrel',
              montant: null,
              devise: null,
              recrutement: false,
              resumeRecrutement: null,
            },
            {
              nom: 'Orbis',
              montant: null,
              devise: null,
              recrutement: false,
              resumeRecrutement: null,
            },
          ],
        },
      ]),
    );

    expect(valides).toHaveLength(1);
    expect(bilan).toEqual({
      demandes: 1,
      lues: 1,
      levees: 2,
      rejets: [],
      fichierAbsent: false,
    });
  });

  it("signale l'absence du fichier de lectures : la lecture n'a pas tourne", () => {
    expect(preparerImport(aLire, null)).toEqual({
      valides: [],
      bilan: {
        demandes: 1,
        lues: 0,
        levees: 0,
        rejets: [],
        fichierAbsent: true,
      },
    });
  });

  it('rejette un fichier de lectures qui ne se lit pas en JSON', () => {
    expect(preparerImport(aLire, '{ pas du json').bilan.rejets).toEqual([
      { url: null, raison: 'fichier illisible' },
    ]);
  });
});

describe('ajouterAuJournal', () => {
  const journal: Journal = {
    run: '2026-11-21T15:00:00.000Z',
    declencheur: 'schedule',
    etapes: [],
    echecs: [],
    purge: {},
    tailles: {},
    octetsBase: 0,
  };
  const bilan = {
    demandes: 3,
    lues: 2,
    levees: 4,
    rejets: [],
    fichierAbsent: false,
  };

  it('ajoute le bilan de la lecture', () => {
    expect(ajouterAuJournal(journal, bilan).lecture).toEqual({
      demandes: 3,
      lues: 2,
      levees: 4,
      rejets: 0,
    });
    expect(ajouterAuJournal(journal, bilan).echecs).toEqual([]);
  });

  it("signale un echec quand des articles etaient demandes mais qu'aucun fichier n'est revenu (jeton expire, quota atteint)", () => {
    const resultat = ajouterAuJournal(journal, {
      ...bilan,
      lues: 0,
      levees: 0,
      fichierAbsent: true,
    });

    expect(resultat.echecs).toHaveLength(1);
    expect(resultat.echecs[0].etape).toBe('Lecture des articles (Claude)');
    expect(resultat.echecs[0].message).toMatch(/jeton|quota/);
  });

  it("ne signale rien quand il n'y avait aucun article a lire", () => {
    expect(
      ajouterAuJournal(journal, {
        ...bilan,
        demandes: 0,
        lues: 0,
        levees: 0,
        fichierAbsent: true,
      }).echecs,
    ).toEqual([]);
  });

  it('signale les lectures rejetees, avec leur raison', () => {
    const resultat = ajouterAuJournal(journal, {
      ...bilan,
      rejets: [
        { url: 'https://www.maddyness.com/a/', raison: 'article non demandé' },
      ],
    });

    expect(resultat.echecs).toEqual([
      {
        etape: 'Lecture des articles (Claude)',
        message:
          '1 lecture(s) rejetée(s) : https://www.maddyness.com/a/ (article non demandé)',
      },
    ]);
  });
});
