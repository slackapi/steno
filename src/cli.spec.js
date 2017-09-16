import test from 'ava';
import { default as main } from './../build/cli';

test((t) => {
  process.argv = 'node bin/cli.js --record'.split(' ');
  main.__Rewire__('Controller', class {
    constructor() {
      console.log('mocked controller');
    }
  });
  main();
  t.pass();
  main.__ResetDependency__('Controller');
});

