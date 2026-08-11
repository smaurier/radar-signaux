import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

try {
  // charge .env s'il existe (jamais committe, cf .gitignore) ; en
  // production les variables peuvent aussi venir directement de l'environnement
  process.loadEnvFile();
} catch {
  // pas de .env present, ok
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
