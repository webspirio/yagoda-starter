import { registerAs } from '@nestjs/config';
import { databaseEnv } from './database.defaults';

export const databaseConfig = registerAs('database', databaseEnv);
