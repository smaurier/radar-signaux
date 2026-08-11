import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createTransport, Transporter } from 'nodemailer';
import { BodaccSignal, StorageService } from '../storage/storage.service';
import { isSecteurTechProbable } from '../entreprises/entreprises.service';

/**
 * Digest email quotidien des signaux BODACC pas encore notifies. Envoi via
 * Gmail SMTP + mot de passe d'application (pas Telegram : Sylvain n'a pas
 * l'app, cf memory/project_radar_signaux.md du 11/08).
 *
 * Credentials en variables d'environnement uniquement (.env local, jamais
 * committe) : GMAIL_USER, GMAIL_APP_PASSWORD, RADAR_NOTIFY_TO.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly storage: StorageService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error(
        'GMAIL_USER / GMAIL_APP_PASSWORD manquants (.env) : notifications email desactivees.',
      );
    }
    this.transporter = createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
    return this.transporter;
  }

  // ~30 min apres le cron BODACC (7h) : laisse le temps a la detection et a
  // la confirmation presse de tourner avant d'envoyer le digest.
  @Cron('30 7 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  /** Envoie (si besoin) un digest des signaux pas encore notifies. Retourne le nombre envoye. */
  async run(): Promise<number> {
    const signaux = this.storage.listUnnotified();
    if (signaux.length === 0) {
      this.logger.log('Notifications : rien de nouveau a envoyer.');
      return 0;
    }

    const to = process.env.RADAR_NOTIFY_TO ?? process.env.GMAIL_USER;
    if (!to) {
      throw new Error('RADAR_NOTIFY_TO (ou GMAIL_USER) manquant (.env).');
    }

    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `radar-signaux : ${signaux.length} signal(aux) BODACC`,
      text: this.buildTextBody(signaux),
      html: this.buildHtmlBody(signaux),
    });

    this.storage.markNotified(signaux.map((s) => ({ siren: s.siren, dateParution: s.dateParution })));
    this.logger.log(`Notifications : digest envoye (${signaux.length} signal(aux)).`);
    return signaux.length;
  }

  /**
   * Separe tech-probable (detail complet dans le mail) du reste (compte
   * seulement, consultable via l'API). Necessaire depuis le passage a la
   * France entiere le 11/08 (~250 signaux/jour vs une poignee en region) :
   * un mail listant tout devient illisible. Pas un filtre de stockage —
   * tout reste dans la base et dans /bodacc/signaux, seul l'AFFICHAGE
   * du digest est resume.
   */
  private separer(signaux: BodaccSignal[]): { techProbable: BodaccSignal[]; autres: BodaccSignal[] } {
    const techProbable: BodaccSignal[] = [];
    const autres: BodaccSignal[] = [];
    for (const s of signaux) {
      (isSecteurTechProbable(s.nafCode, s.sectionActivite) ? techProbable : autres).push(s);
    }
    return { techProbable, autres };
  }

  private descriptionSecteur(s: BodaccSignal): string {
    if (!s.enrichi) return '(non enrichi)';
    const parts = [
      s.nafCode ? `NAF ${s.nafCode}` : null,
      s.categorieEntreprise,
      s.trancheEffectif ? `effectif ${s.trancheEffectif}` : null,
      s.dateCreation ? `cree ${s.dateCreation}` : null,
      typeof s.inpiCapital === 'number'
        ? `capital actuel ${s.inpiCapital.toLocaleString('fr-FR')} €`
        : null,
      this.descriptionActe(s),
    ].filter(Boolean);
    const tag = isSecteurTechProbable(s.nafCode, s.sectionActivite) ? '🔧 tech probable — ' : '';
    return `${tag}${parts.join(', ') || 'donnees indisponibles'}`;
  }

  /** Sens + montant reels de la modification, quand la lecture d'acte a reussi. */
  private descriptionActe(s: BodaccSignal): string | null {
    if (!s.acteLu || !s.acteSens) return null;
    const delta =
      typeof s.acteCapitalAvant === 'number' && typeof s.acteCapitalApres === 'number'
        ? Math.abs(s.acteCapitalApres - s.acteCapitalAvant)
        : null;
    const fleche = s.acteSens === 'hausse' ? '📈' : '📉';
    const montant = delta !== null ? ` de ${delta.toLocaleString('fr-FR')} €` : '';
    return `${fleche} ${s.acteSens}${montant} (acte lu)`;
  }

  private buildTextBody(signauxBruts: BodaccSignal[]): string {
    const { techProbable, autres } = this.separer(signauxBruts);
    const lignes = techProbable.map((s) => {
      const presse = s.presseConfirmee
        ? ` [confirme presse: ${s.presseSource} - ${s.presseUrl}]`
        : '';
      return `- ${s.commercant} (SIREN ${s.siren}, ${s.dateParution}, ${s.tribunal}) — ${this.descriptionSecteur(s)}${presse}`;
    });
    return [
      `${signauxBruts.length} signal(aux) BODACC pas encore vus.`,
      '',
      `${techProbable.length} tag(ues) tech probable (detail ci-dessous) :`,
      '',
      ...(lignes.length ? lignes : ['(aucun)']),
      '',
      `+ ${autres.length} autre(s) signal(aux) (PME hors NAF tech, ou pas encore enrichi) — consultables via /bodacc/signaux.`,
      '',
      'Rappel : le "capital actuel" (INPI) est l\'etat present, pas le montant de LA modification',
      'detectee au BODACC (qui ne precise ni sens ni montant depuis 2023) -- indice de taille, pas de preuve.',
      '"tech probable" est une heuristique NAF, pas une classification fiable (a verifier manuellement).',
      'Elle peut rater de vraies entreprises tech hors classification standard : a affiner avec l\'usage.',
    ].join('\n');
  }

  private buildHtmlBody(signauxBruts: BodaccSignal[]): string {
    const { techProbable, autres } = this.separer(signauxBruts);
    const lignes = techProbable
      .map((s) => {
        const presse = s.presseConfirmee
          ? ` <em>(confirme presse : ${s.presseSource}, <a href="${s.presseUrl}">article</a>)</em>`
          : '';
        return `<li><strong>${s.commercant}</strong> — SIREN ${s.siren}, ${s.dateParution}, ${s.tribunal}<br><small>${this.descriptionSecteur(s)}</small>${presse}</li>`;
      })
      .join('\n');
    return `<p>${signauxBruts.length} signal(aux) BODACC pas encore vus.</p>
      <p><strong>${techProbable.length} tague(s) tech probable</strong> (detail) :</p>
      <ul>${lignes || '<li>(aucun)</li>'}</ul>
      <p>+ <strong>${autres.length}</strong> autre(s) signal(aux) (PME hors NAF tech, ou pas encore enrichi) — consultables via <code>/bodacc/signaux</code>.</p>
      <p><small>Rappel : le « capital actuel » (INPI) est l'etat present, pas le montant de LA
      modification detectee au BODACC (qui ne precise ni sens ni montant depuis 2023) — indice de
      taille, pas de preuve. « tech probable » est une heuristique NAF, pas une classification
      fiable — a verifier manuellement, et peut rater de vraies entreprises tech hors classification
      standard (a affiner avec l'usage).</small></p>`;
  }
}
