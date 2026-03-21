import js from '@eslint/js';
import globals from 'globals';

const cdnGlobals = {
  google:    'readonly',  // Google Maps API (CDN)
  satellite: 'readonly',  // satellite.js SGP4 library (CDN)
};

// Globals defined in one script file and consumed by another via window scope.
// Only applied to app.js which is the consumer of all other modules.
const crossFileGlobals = {
  WORKER_URL:           'readonly',  // gist.js
  UGORecorder:          'readonly',  // recorder.js
  UGOVisualizer:        'readonly',  // visualizer.js
  SatTracker:           'readonly',  // iss.js
  ConstellationTracker: 'readonly',  // satellites.js
  WelcomeMessage:       'readonly',  // welcome.js
  createGist:           'readonly',  // gist.js
  importKML:            'readonly',  // kml.js
  exportKML:            'readonly',  // kml.js
  downloadKML:          'readonly',  // kml.js
};

export default [
  js.configs.recommended,
  // All JS files — browser environment + CDN globals
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...cdnGlobals },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'no-empty': 'warn',
    },
  },
  // app.js — add cross-file class globals it consumes
  {
    files: ['js/app.js'],
    languageOptions: {
      globals: crossFileGlobals,
    },
    rules: {
      // initMap is the Maps API callback — called externally, not from our code
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^(_|initMap)',
      }],
    },
  },
  // iss.js and satellites.js — consume WORKER_URL from gist.js
  {
    files: ['js/iss.js', 'js/satellites.js'],
    languageOptions: {
      globals: { WORKER_URL: 'readonly' },
    },
  },
  // kml.js — typeof exports check is intentional for test/Node environments
  {
    files: ['js/kml.js'],
    languageOptions: {
      globals: { exports: 'readonly' },
    },
  },
];
