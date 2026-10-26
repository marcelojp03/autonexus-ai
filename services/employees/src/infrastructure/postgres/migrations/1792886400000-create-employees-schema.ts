import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmployeesSchema1792886400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS employees');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SCHEMA employees');
  }
}
