import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ecrireJournal,
  listerJournaux,
  purgerJournaux,
} from './journal-fichiers';
import { construireJournal } from './journal';

describe('journal sur disque', () => {
  let racine: string;
  const maintenant = new Date('2026-11-04T07:02:13Z');

  const journalMinimal = () =>
    construireJournal({
      maintenant,
      declencheur: 'schedule',
      etapes: [{ nom: 'BODACC (detection)', dureeMs: 24_000 }],
      purge: { bodacc_signaux: 3 },
      tailles: { bodacc_signaux: 11_392 },
      octetsBase: 3_981_312,
    });

  const deposer = (chemin: string, contenu = '{}') => {
    const complet = join(racine, chemin);
    mkdirSync(join(complet, '..'), { recursive: true });
    writeFileSync(complet, contenu, 'utf8');
  };

  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'radar-journal-'));
  });

  afterEach(() => {
    rmSync(racine, { recursive: true, force: true });
  });

  it('ecrit le journal du jour, en creant l arborescence', () => {
    const chemin = ecrireJournal(racine, journalMinimal(), maintenant);

    expect(chemin).toBe('journal/2026/11/04.json');
    expect(existsSync(join(racine, chemin))).toBe(true);
  });

  it('ecrit un JSON relisible et indente, pour que le diff git soit lisible', () => {
    ecrireJournal(racine, journalMinimal(), maintenant);
    const brut = readFileSync(join(racine, 'journal/2026/11/04.json'), 'utf8');

    expect(brut).toContain('\n  "run"');
    expect(JSON.parse(brut)).toMatchObject({
      run: '2026-11-04T07:02:13.000Z',
      declencheur: 'schedule',
      purge: { bodacc_signaux: 3 },
    });
  });

  it('ecrase le journal du jour si le run est rejoue le meme jour', () => {
    // Un declenchement manuel apres le run planifie ne doit pas creer un
    // second fichier : un jour, un journal, le dernier etat gagne.
    ecrireJournal(racine, journalMinimal(), maintenant);
    ecrireJournal(
      racine,
      construireJournal({
        maintenant,
        declencheur: 'workflow_dispatch',
        etapes: [],
        purge: {},
        tailles: {},
        octetsBase: 0,
      }),
      maintenant,
    );

    const relu = JSON.parse(
      readFileSync(join(racine, 'journal/2026/11/04.json'), 'utf8'),
    ) as { declencheur: string };
    expect(relu.declencheur).toBe('workflow_dispatch');
  });

  it('liste les journaux existants en chemins relatifs a barres obliques', () => {
    deposer('journal/2026/11/04.json');
    deposer('journal/2025/01/02.json');

    expect(listerJournaux(racine).sort()).toEqual([
      'journal/2025/01/02.json',
      'journal/2026/11/04.json',
    ]);
  });

  it('rend une liste vide quand le dossier journal n existe pas encore', () => {
    expect(listerJournaux(racine)).toEqual([]);
  });

  it('supprime les journaux de plus d un an et rend la liste des supprimes', () => {
    deposer('journal/2025/10/31.json');
    deposer('journal/2026/11/04.json');

    const supprimes = purgerJournaux(racine, maintenant);

    expect(supprimes).toEqual(['journal/2025/10/31.json']);
    expect(existsSync(join(racine, 'journal/2025/10/31.json'))).toBe(false);
    expect(existsSync(join(racine, 'journal/2026/11/04.json'))).toBe(true);
  });

  it('ne touche pas un fichier etranger depose dans journal/', () => {
    deposer('journal/notes.md', '# note');

    expect(purgerJournaux(racine, maintenant)).toEqual([]);
    expect(existsSync(join(racine, 'journal/notes.md'))).toBe(true);
  });
});
