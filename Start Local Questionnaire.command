#!/bin/bash
cd "$(dirname "$0")" || exit 1
npm run local:start
open 'http://localhost:5173'
