import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { StorageService } from '../storage/storage.service';

interface FeedSource {
  source: string;
  url: string;
}

/**
 * Confirmation presse (mode Dev, etape 3 du pipeline) : croise les signaux
 * BODACC pas encore confirmes avec les flux RSS de presse specialisee, par
 * matching de nom d'entreprise. Un match ne prouve pas le montant/sens de
 * la levee, juste que la presse en parle -> a lire manuellement avant tout
 * usage (candidature, prospection).
 *
 * Flux retenus (testes actifs le 01/08/2026, cf etude de faisabilite) :
 * Maddyness et FrenchWeb. Eldorado ecarte (flux RSS mort).
 */
@Injectable()
export class PresseService {
  private readonly logger = new Logger(PresseService.name);
  private readonly parser = new Parser();

  private readonly feeds: FeedSource[] = [
    { source: 'maddyness', url: 'https://www.maddyness.com/feed/' },
    { source: 'frenchweb', url: 'https://www.frenchweb.fr/feed' },
  ];

  // suffixes/mots juridiques ou generiques a retirer avant matching, pour
  // eviter de chercher "SAS" ou "HOLDING" seul dans un article
  private readonly bruitLegal = new Set([
    'SAS', 'SASU', 'SARL', 'EURL', 'SCI', 'SA', 'SNC', 'SCP', 'SELARL',
    'SCM', 'HOLDING', 'GROUP', 'GROUPE', 'INVEST', 'INVESTMENT',
    'INVESTMENTS', 'PARTICIPATIONS', 'CO', 'COMPANY', 'FRANCE', 'SOCIETE',
    'CIVILE', 'IMMOBILIERE',
  ]);

  constructor(private readonly storage: StorageService) {}

  // ~15 min apres le cron BODACC (7h) : laisse le temps a la detection de
  // remplir la table avant de tenter la confirmation.
  @Cron('15 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(): Promise<
    Array<{ siren: string; commercant: string; source: string; url: string; titre: string }>
  > {
    const candidats = this.storage
      .listUnconfirmedByPresse()
      .map((s) => ({ ...s, core: this.nomCoeur(s.commercant) }))
      .filter((c) => c.core.length >= 4); // noms trop courts/generiques = trop de faux positifs

    if (candidats.length === 0) {
      this.logger.log('Presse : aucun signal en attente de confirmation.');
      return [];
    }

    const dejaConfirmes = new Set<string>();
    const matches: Array<{
      siren: string;
      commercant: string;
      source: string;
      url: string;
      titre: string;
    }> = [];

    for (const feed of this.feeds) {
      let items: Parser.Item[];
      try {
        const parsed = await this.parser.parseURL(feed.url);
        items = parsed.items ?? [];
      } catch (err) {
        this.logger.warn(
          `Flux ${feed.source} injoignable ou invalide, ignore (${(err as Error).message})`,
        );
        continue;
      }

      for (const item of items) {
        const texte = this.normaliser(
          `${item.title ?? ''} ${item.contentSnippet ?? item.content ?? ''}`,
        );

        for (const candidat of candidats) {
          const cle = `${candidat.siren}|${candidat.dateParution}`;
          if (dejaConfirmes.has(cle)) continue;

          const motif = new RegExp(`\\b${this.echapperRegex(candidat.core)}\\b`);
          if (motif.test(texte)) {
            this.storage.markConfirmedByPresse(candidat.siren, candidat.dateParution, {
              source: feed.source,
              url: item.link ?? '',
              titre: item.title ?? '',
            });
            dejaConfirmes.add(cle);
            matches.push({
              siren: candidat.siren,
              commercant: candidat.commercant,
              source: feed.source,
              url: item.link ?? '',
              titre: item.title ?? '',
            });
          }
        }
      }
    }

    this.logger.log(
      `Presse : ${candidats.length} candidat(s) teste(s), ${matches.length} confirme(s) par la presse.`,
    );
    return matches;
  }

  private readonly accents: Record<string, string> = {
    À: 'A', Â: 'A', Ä: 'A', Á: 'A',
    É: 'E', È: 'E', Ê: 'E', Ë: 'E',
    Î: 'I', Ï: 'I',
    Ô: 'O', Ö: 'O',
    Ù: 'U', Û: 'U', Ü: 'U',
    Ç: 'C', Ñ: 'N',
  };

  /** Majuscules, sans accents, ponctuation reduite en espaces. */
  private normaliser(texte: string): string {
    const majuscule = texte.toUpperCase();
    const sansAccents = majuscule
      .split('')
      .map((car) => this.accents[car] ?? car)
      .join('');
    return sansAccents.replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Nom d'entreprise normalise, purge des formes juridiques/mots generiques. */
  private nomCoeur(commercant: string): string {
    return this.normaliser(commercant)
      .split(' ')
      .filter((mot) => mot && !this.bruitLegal.has(mot))
      .join(' ')
      .trim();
  }

  private echapperRegex(texte: string): string {
    return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
