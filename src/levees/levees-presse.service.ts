import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { StorageService } from '../storage/storage.service';
import { ArticlePresse, versArticles } from './article-presse';

interface Flux {
  source: string;
  url: string;
}

/**
 * Collecte quotidienne des articles de presse tech, point d'entree du mode
 * levees : une levee annoncee dans la presse precede de 1 a 7 mois sa trace au
 * BODACC (test du 20/11/2026). Chaque article est garde avec ce que son titre
 * dit de la levee ; la lecture des articles eux-memes viendra ensuite.
 *
 * ⛔ FrenchWeb refuse les robots d'IA dans son robots.txt : de ses articles, on
 * ne garde que le titre, jamais le texte.
 */
@Injectable()
export class LeveesPresseService {
  private readonly logger = new Logger(LeveesPresseService.name);
  private readonly parser = new Parser();

  private readonly flux: Flux[] = [
    { source: 'maddyness', url: 'https://www.maddyness.com/feed/' },
    { source: 'frenchweb', url: 'https://www.frenchweb.fr/feed/' },
  ];

  constructor(private readonly storage: StorageService) {}

  @Cron('20 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(): Promise<ArticlePresse[]> {
    const articles: ArticlePresse[] = [];

    for (const { source, url } of this.flux) {
      try {
        const lu = await this.parser.parseURL(url);
        articles.push(...versArticles(source, lu.items ?? []));
      } catch (err) {
        this.logger.warn(
          `Flux ${source} injoignable ou invalide, ignore (${(err as Error).message})`,
        );
      }
    }

    const nouveaux = this.storage.enregistrerArticles(articles);
    const levees = nouveaux.filter((a) => a.genre === 'levee');
    this.logger.log(
      `Levees presse : ${articles.length} article(s) lu(s), ${nouveaux.length} nouveau(x), ` +
        `dont ${levees.length} levee(s) (${levees.filter((a) => a.nom).length} nommee(s)) ` +
        `et ${nouveaux.filter((a) => a.genre === 'recap').length} recap(s).`,
    );
    return nouveaux;
  }
}
