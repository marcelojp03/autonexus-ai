import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { G2Service } from '@delon/chart/core';
import { AlainConfigService } from '@delon/util/config';
import { LazyService } from '@delon/util/other';
import { assert, test } from 'vitest';

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function fixture() {
  let resolve!: () => void;
  let loads = 0;
  const pending = new Promise<void>(done => {
    resolve = done;
  });
  const injector = createEnvironmentInjector(
    [
      G2Service,
      { provide: AlainConfigService, useValue: { merge: (_key: string, defaults: object, value: object) => ({ ...defaults, ...value }) } },
      {
        provide: LazyService,
        useValue: {
          load: () => {
            loads++;
            return pending;
          }
        }
      }
    ],
    TestBed.inject(EnvironmentInjector)
  );
  const service = injector.get(G2Service);
  let emissions = 0;
  service.notify.subscribe(() => {
    emissions++;
  });
  return {
    injector,
    service,
    resolve,
    get loads() {
      return loads;
    },
    get emissions() {
      return emissions;
    }
  };
}

test('live resolution emits once and returns the service', async () => {
  const f = fixture();
  try {
    assert.equal(f.service.libLoad(), f.service);
    assert.equal(f.emissions, 0);
    f.resolve();
    await settle();
    assert.equal(f.loads, 1);
    assert.equal(f.emissions, 1);
  } finally {
    f.injector.destroy();
  }
});

test('repeated pending calls share one load; loaded calls notify normally', async () => {
  const f = fixture();
  try {
    f.service.libLoad().libLoad();
    assert.equal(f.loads, 1);
    f.resolve();
    await settle();
    assert.equal(f.emissions, 1);
    assert.equal(f.service.libLoad(), f.service);
    assert.equal(f.emissions, 2);
    assert.equal(f.loads, 1);
  } finally {
    f.injector.destroy();
  }
});

test('destroy before deferred resolution causes no emission or unhandled rejection', async () => {
  const f = fixture();
  f.service.libLoad();
  f.injector.destroy();
  f.resolve();
  await settle();
  assert.equal(f.emissions, 0);
});

test('libLoad after destruction starts no load and remains chainable', () => {
  const f = fixture();
  f.injector.destroy();
  assert.equal(f.service.libLoad(), f.service);
  assert.equal(f.loads, 0);
});

test('destroy after loading makes subsequent libLoad inert', async () => {
  const f = fixture();
  f.service.libLoad();
  f.resolve();
  await settle();
  f.injector.destroy();
  assert.equal(f.service.libLoad(), f.service);
  assert.equal(f.loads, 1);
  assert.equal(f.emissions, 1);
});

test('fresh injector after pending destruction loads an independent service', async () => {
  const old = fixture();
  old.service.libLoad();
  old.injector.destroy();
  const fresh = fixture();
  try {
    assert.notEqual(old.service, fresh.service);
    fresh.service.libLoad();
    old.resolve();
    fresh.resolve();
    await settle();
    assert.equal(old.emissions, 0);
    assert.equal(fresh.loads, 1);
    assert.equal(fresh.emissions, 1);
  } finally {
    fresh.injector.destroy();
  }
});
