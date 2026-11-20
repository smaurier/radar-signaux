import { lireTitre } from './titre-levee';

/**
 * Les titres sont inventes (aucune entreprise reelle), mais chacun reprend la
 * FORME exacte d'un titre releve dans les flux Maddyness et FrenchWeb entre le
 * 20/10 et le 20/11/2026. C'est la forme qui compte pour la lecture, pas le nom.
 */
describe('lireTitre', () => {
  describe("titre d'une levee : nom et montant quand le titre les donne", () => {
    it.each([
      [
        "NOVA ROBOTICS lève 425 millions d'euros pour déployer ses robots en usine",
        'NOVA ROBOTICS',
        425_000_000,
        'EUR',
      ],
      [
        'Brindille lève 250 millions de dollars avec Nvidia au tour de table',
        'Brindille',
        250_000_000,
        'USD',
      ],
      [
        "Elan Énergie lève 30 millions d'euros pour rendre les chauffe-eau plus économes",
        'Elan Énergie',
        30_000_000,
        'EUR',
      ],
      [
        "QUARTZ lève 4,7 millions d'euros pour développer un accélérateur quantique photonique",
        'QUARTZ',
        4_700_000,
        'EUR',
      ],
      [
        "Après un nouveau cap de revenus récurrents, Brindille lève 223 millions d'euros pour poursuivre son expansion",
        'Brindille',
        223_000_000,
        'EUR',
      ],
      [
        'Fintech : Bolide lève 7,1 M€ pour financer son expansion',
        'Bolide',
        7_100_000,
        'EUR',
      ],
      [
        'Robotique : Orbis boucle une série A d’un demi-milliard de dollars auprès de Nvidia, Samsung et Zoom',
        'Orbis',
        500_000_000,
        'USD',
      ],
      [
        'Trois anciens de MERIDIAN lèvent 25,5 millions d’euros pour REMANENT',
        'REMANENT',
        25_500_000,
        'EUR',
      ],
      [
        "Plural Tech lève 1 milliard d'euros pour la deeptech européenne",
        'Plural Tech',
        1_000_000_000,
        'EUR',
      ],
      [
        'Kiwi lève 500 000 euros pour lancer son application',
        'Kiwi',
        500_000,
        'EUR',
      ],
    ])('%s', (titre, nom, valeur, devise) => {
      expect(lireTitre(titre)).toEqual({
        genre: 'levee',
        nom,
        montant: { valeur, devise },
      });
    });
  });

  describe("titre d'une levee qui ne nomme pas l'entreprise : nom inconnu, a lire dans l'article", () => {
    it('le sujet est une personne', () => {
      expect(
        lireTitre(
          "Défense : le fondateur de Kestrel lève 7,7 millions d'euros avec la holding de son associé pour sa startup anti-drones",
        ),
      ).toEqual({
        genre: 'levee',
        nom: null,
        montant: { valeur: 7_700_000, devise: 'EUR' },
      });
    });

    it('le sujet est un groupe de fondateurs, sans montant', () => {
      expect(
        lireTitre(
          'Deux anciens d’Azimut bouclent un tour de table pour leur assistant IA dédié aux dirigeants de petites entreprises',
        ),
      ).toEqual({ genre: 'levee', nom: null, montant: null });
    });

    it('la levee est un complement, pas le verbe', () => {
      expect(
        lireTitre(
          'IA : des anciens de Meridian lancent leur startup avec une levée de fonds de 30 millions de dollars',
        ),
      ).toEqual({
        genre: 'levee',
        nom: null,
        montant: { valeur: 30_000_000, devise: 'USD' },
      });
    });
  });

  it('lit un titre en typographie francaise, avec une espace insecable avant les deux-points', () => {
    const insecable = String.fromCharCode(0xa0);

    expect(
      lireTitre(
        `Fintech${insecable}: Bolide lève 7,1${insecable}M€ pour financer son expansion`,
      ),
    ).toEqual({
      genre: 'levee',
      nom: 'Bolide',
      montant: { valeur: 7_100_000, devise: 'EUR' },
    });
  });

  describe('recapitulatif : plusieurs levees dans un seul article', () => {
    it.each([
      'Les startups françaises ont levé 118 millions d’euros cette semaine',
      'French Tech : près de 271 millions d’euros levés en une semaine, portés par Brindille',
      'Portée par Brindille, la French Tech lève 614,7 millions d’euros en octobre',
    ])('%s', (titre) => {
      expect(lireTitre(titre)).toEqual({
        genre: 'recap',
        nom: null,
        montant: null,
      });
    });
  });

  describe("pas une levee d'entreprise", () => {
    it.each([
      // le verbe est au passe, l'entreprise ferme
      'JOLIE ferme après avoir levé plus de 10 millions d’euros',
      // "boucle" sans tour de table
      'Le salon boucle sa tournée européenne avant de fêter ses 60 ans',
      // des millions, mais pas d'argent
      'Cyberattaque chez POSTA, les coordonnées de 22 millions de personnes dérobées',
      // un fonds d'investissement qui leve pour lui-meme
      'Sofina Partners lève 725 millions d’euros pour son fonds Crossover II',
      // "élève" contient "lève"
      'Un élève ingénieur lance sa startup pour 2 000 euros',
      // le titre ne dit rien de la levee : seul l'article la revele (cas reel)
      'Cette startup traque les vulnérabilités des applications en pleine explosion du code généré par IA',
    ])('%s', (titre) => {
      expect(lireTitre(titre)).toBeNull();
    });
  });
});
