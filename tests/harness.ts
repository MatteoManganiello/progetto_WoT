/** Micro-harness sincrono: nessuna dipendenza aggiuntiva, output leggibile. */

let currentSuite = "";
let passed = 0;
const failures: Array<{ suite: string; name: string; error: unknown }> = [];

export const suite = (name: string) => {
  currentSuite = name;
  console.log(`\n${name}`);
};

export const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ suite: currentSuite, name, error });
    console.log(`  FAIL  ${name}`);
  }
};

/** Variante asincrona: serve alle verifiche end-to-end, che passano dalla rete. */
export const testAsync = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ suite: currentSuite, name, error });
    console.log(`  FAIL  ${name}`);
  }
};

export const summary = () => {
  console.log(`\n${passed} test superati, ${failures.length} falliti`);
  for (const failure of failures) {
    console.error(`\n[${failure.suite}] ${failure.name}`);
    console.error(failure.error);
  }
  if (failures.length > 0) {
    process.exit(1);
  }
};

