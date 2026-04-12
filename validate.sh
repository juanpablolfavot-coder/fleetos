#!/bin/bash
echo "=== Validando sintaxis JS ==="
ERRORS=0

for f in public/js/app.js public/js/roles.js; do
  result=$(node --check "$f" 2>&1)
  if [ $? -ne 0 ]; then
    echo "❌ ERROR en $f:"
    echo "$result"
    ERRORS=$((ERRORS+1))
  else
    echo "✓ $f OK"
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo "=== $ERRORS ERRORES — NO pushear ==="
  exit 1
else
  echo "=== Todo OK — listo para push ==="
  exit 0
fi
