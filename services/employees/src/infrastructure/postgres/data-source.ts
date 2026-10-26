import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadLocalEnvironment } from '../config/environment.js';
import { dataSourceOptions } from './data-source-options.js';

loadLocalEnvironment();

export default new DataSource(dataSourceOptions());
