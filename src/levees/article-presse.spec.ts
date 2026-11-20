import { versArticles } from './article-presse';

describe('versArticles', () => {
  it("lit le titre d'une levee : nom, montant et devise", () => {
    const [article] = versArticles('frenchweb', [
      {
        title:
          "QUARTZ lève 4,7 millions d'euros pour développer un accélérateur",
        link: 'https://exemple.fr/quartz',
        isoDate: '2026-11-17T08:00:00.000Z',
      },
    ]);

    expect(article).toEqual({
      url: 'https://exemple.fr/quartz',
      source: 'frenchweb',
      publieLe: '2026-11-17T08:00:00.000Z',
      titre: "QUARTZ lève 4,7 millions d'euros pour développer un accélérateur",
      genre: 'levee',
      nom: 'QUARTZ',
      montant: 4_700_000,
      devise: 'EUR',
    });
  });

  it("garde un article dont le titre ne dit rien : seule la lecture de l'article dira s'il annonce une levee", () => {
    const [article] = versArticles('maddyness', [
      {
        title: 'Cette startup traque les vulnérabilités des applications',
        link: 'https://exemple.fr/startup',
      },
    ]);

    expect(article).toMatchObject({
      url: 'https://exemple.fr/startup',
      publieLe: null,
      genre: null,
      nom: null,
      montant: null,
      devise: null,
    });
  });

  it('ignore une entree de flux sans lien ou sans titre', () => {
    expect(
      versArticles('maddyness', [
        { title: 'Sans lien' },
        { link: 'https://exemple.fr/sans-titre' },
        { title: '   ', link: 'https://exemple.fr/titre-vide' },
      ]),
    ).toEqual([]);
  });
});
