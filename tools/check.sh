#!/bin/sh
# Runs both checks; exits non-zero if either fails. Use before every commit:  sh tools/check.sh
cd "$(dirname "$0")/.." || exit 1
node tools/test.mjs > /tmp/whopays-test.log 2>&1; t=$?
node tools/verif.mjs > /tmp/whopays-verif.log 2>&1; v=$?
tail -n 1 /tmp/whopays-test.log
grep -E "^ÉCHEC|^         -" /tmp/whopays-test.log /tmp/whopays-verif.log
tail -n 1 /tmp/whopays-verif.log
[ $t -eq 0 ] && [ $v -eq 0 ]
