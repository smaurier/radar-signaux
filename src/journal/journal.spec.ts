import {
  POLITIQUE_RETENTION,
  verifierInvariantRetention,
  cheminJournal,
  construireJournal,
  journauxAPurger,
  RETENTION_JOURNAL_JOURS,
} from './journal';

/**
 * L'invariant central de ce module a ete trouve le 04/11/2026 en relisant la
 * raison d'etre de la purge. La dedup des signaux BODACC ne repose PAS sur une
 * marque "deja vu" : elle repose sur la cle primaire (siren, date_parution) et
 * un `INSERT OR IGNORE`. Donc purger une ligne REAUTORISE son retraitement,
 * c'est l'inverse de l'intuition.
 *
 * Ce qui rend la purge sans danger, c'est la fenetre de collecte : BODACC n'est
 * interroge que sur `BODACC_LOOKBACK_DAYS` jours (7 par defaut), donc une
 * parution plus vieille que la fenetre ne peut plus revenir de l'API. L'invariant
 * a tenir est donc : retention >> fenetre de collecte. S'il est casse, on
 * renotifie du vieux (les 11 392 lignes de la base sont deja a notifie_email=1).
 */
describe('politique de retention', () => {
  it('garde les signaux BODACC 3 mois et les prospects a11y 1 an', () => {
    const parTable = Object.fromEntries(
      POLITIQUE_RETENTION.map((r) => [r.table, r]),
    );

    expect(parTable['bodacc_signaux']).toMatchObject({
      colonne: 'first_seen_at',
      jours: 90,
    });
    expect(parTable['a11y_prospects']).toMatchObject({
      colonne: 'traite_le',
      jours: 365,
    });
  });

  it('accepte la fenetre de collecte par defaut (7 jours)', () => {
    expect(() => verifierInvariantRetention(7)).not.toThrow();
  });

  it('refuse une fenetre de collecte qui atteint la plus courte retention', () => {
    expect(() => verifierInvariantRetention(90)).toThrow(
      /retention.*fenetre de collecte/i,
    );
  });

  it('refuse meme une fenetre qui approche la retention, pas seulement qui la depasse', () => {
    // 80 jours contre 90 de retention : l'API ne renverrait pas encore le
    // signal purge, mais la marge est trop mince pour qu'un decalage de
    // quelques jours reste sans effet. On exige un facteur de securite.
    expect(() => verifierInvariantRetention(80)).toThrow(
      /retention.*fenetre de collecte/i,
    );
  });

  it('nomme la table fautive et les deux valeurs dans le message', () => {
    expect(() => verifierInvariantRetention(120)).toThrow(/bodacc_signaux/);
    expect(() => verifierInvariantRetention(120)).toThrow(/120/);
    expect(() => verifierInvariantRetention(120)).toThrow(/90/);
  });
});

describe('chemin du journal', () => {
  it('range un run sous journal/AAAA/MM/JJ.json', () => {
    expect(cheminJournal(new Date('2026-11-04T07:02:13Z'))).toBe(
      'journal/2026/11/04.json',
    );
  });

  it('complete le mois et le jour a deux chiffres', () => {
    expect(cheminJournal(new Date('2027-01-09T23:59:00Z'))).toBe(
      'journal/2027/01/09.json',
    );
  });

  it('se cale sur UTC, pas sur le fuseau de la machine', () => {
    // Le cron tourne sur un runner GitHub en UTC. Un run du 4 novembre a
    // 23h30 UTC doit rester le 4, meme si la machine qui relit est a Paris.
    expect(cheminJournal(new Date('2026-11-04T23:30:00Z'))).toBe(
      'journal/2026/11/04.json',
    );
  });
});

describe('construction du journal', () => {
  const etapes = [
    { nom: 'BODACC (detection)', dureeMs: 24_000 },
    {
      nom: 'Lecture actes INPI (sens/montant)',
      dureeMs: 1_200,
      echec: 'timeout INPI',
    },
  ];

  it('resume le run : horodatage, declencheur, etapes, purge et tailles', () => {
    const journal = construireJournal({
      maintenant: new Date('2026-11-04T07:02:13Z'),
      declencheur: 'schedule',
      etapes,
      purge: { bodacc_signaux: 12, a11y_prospects: 0 },
      tailles: { bodacc_signaux: 11_392, a11y_prospects: 936 },
      octetsBase: 3_981_312,
    });

    expect(journal.run).toBe('2026-11-04T07:02:13.000Z');
    expect(journal.declencheur).toBe('schedule');
    expect(journal.etapes).toHaveLength(2);
    expect(journal.purge).toEqual({ bodacc_signaux: 12, a11y_prospects: 0 });
    expect(journal.tailles).toEqual({
      bodacc_signaux: 11_392,
      a11y_prospects: 936,
    });
    expect(journal.octetsBase).toBe(3_981_312);
  });

  it('isole les echecs dans leur propre liste, sans les perdre des etapes', () => {
    const journal = construireJournal({
      maintenant: new Date('2026-11-04T07:02:13Z'),
      declencheur: 'workflow_dispatch',
      etapes,
      purge: {},
      tailles: {},
      octetsBase: 0,
    });

    expect(journal.echecs).toEqual([
      {
        etape: 'Lecture actes INPI (sens/montant)',
        message: 'timeout INPI',
      },
    ]);
    // Une etape en echec reste listee dans les etapes : le journal doit dire
    // qu'elle a tourne et combien de temps, pas seulement qu'elle a rate.
    expect(journal.etapes.map((e) => e.nom)).toContain(
      'Lecture actes INPI (sens/montant)',
    );
  });

  it('arrondit les durees en secondes, comme les logs du runner', () => {
    const journal = construireJournal({
      maintenant: new Date('2026-11-04T07:02:13Z'),
      declencheur: 'schedule',
      etapes: [{ nom: 'BODACC (detection)', dureeMs: 24_600 }],
      purge: {},
      tailles: {},
      octetsBase: 0,
    });

    expect(journal.etapes[0]).toMatchObject({
      nom: 'BODACC (detection)',
      dureeS: 25,
    });
  });

  it('dit explicitement quand aucune etape n a echoue', () => {
    const journal = construireJournal({
      maintenant: new Date('2026-11-04T07:02:13Z'),
      declencheur: 'schedule',
      etapes: [{ nom: 'BODACC (detection)', dureeMs: 1_000 }],
      purge: {},
      tailles: {},
      octetsBase: 0,
    });

    expect(journal.echecs).toEqual([]);
  });
});

describe('purge du journal lui-meme', () => {
  it('garde un an de journaux', () => {
    expect(RETENTION_JOURNAL_JOURS).toBe(365);
  });

  it('supprime les fichiers plus vieux que la retention, garde les autres', () => {
    const fichiers = [
      'journal/2025/10/31.json',
      'journal/2025/11/05.json',
      'journal/2026/11/04.json',
    ];

    expect(journauxAPurger(fichiers, new Date('2026-11-04T07:00:00Z'))).toEqual(
      ['journal/2025/10/31.json'],
    );
  });

  it('ignore un fichier dont le nom ne porte pas une date lisible', () => {
    // Un fichier etranger depose dans journal/ ne doit jamais etre supprime
    // par cette fonction : elle ne touche que ce qu'elle sait datter.
    const fichiers = ['journal/notes.md', 'journal/2024/01/01.json'];

    expect(journauxAPurger(fichiers, new Date('2026-11-04T07:00:00Z'))).toEqual(
      ['journal/2024/01/01.json'],
    );
  });

  it('ne supprime rien le jour pile de la limite', () => {
    const limite = 'journal/2025/11/04.json';

    expect(journauxAPurger([limite], new Date('2026-11-04T07:00:00Z'))).toEqual(
      [],
    );
  });
});
