import { Injectable } from '@nestjs/common';
import { InpiLoginResponse } from './inpi.types';

export const INPI_BASE_URL = 'https://registre-national-entreprises.inpi.fr/api';

/**
 * Authentification INPI partagee entre InpiService (capital actuel) et
 * InpiActesService (lecture des actes) : un seul login par run de process,
 * pas un par service. Pas de gestion de TTL explicite (duree du token
 * inconnue/non documentee) -- en cas d'expiration, le prochain run relance
 * un login frais (chaque run cree une nouvelle instance NestJS).
 */
@Injectable()
export class InpiAuthService {
  private token: string | null = null;

  async getToken(): Promise<string> {
    if (this.token) return this.token;

    const username = process.env.INPI_USERNAME;
    const password = process.env.INPI_PASSWORD;
    if (!username || !password) {
      throw new Error('INPI_USERNAME / INPI_PASSWORD manquants (.env).');
    }
    const response = await fetch(`${INPI_BASE_URL}/sso/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      throw new Error(`Login INPI en echec (${response.status} ${response.statusText})`);
    }
    const body = (await response.json()) as InpiLoginResponse;
    if (!body.token) {
      throw new Error("Login INPI : reponse sans champ 'token' (schema inattendu).");
    }
    this.token = body.token;
    return this.token;
  }
}
