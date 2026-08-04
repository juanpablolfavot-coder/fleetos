# Alerta de consumo de combustible

El gasoil es la línea de costo más grande de la operación. Los datos estaban
cargados desde siempre —litros, odómetro, chofer, fecha, en `fuel_logs`— y nadie
los miraba salvo que alguien se sentara a revisar planillas.

Esto avisa cuando una unidad se sale de **lo suyo**:

```
⛽ Consumo alto: AH327RZ
AH327RZ · 42 L/100km (lo normal 31.8) · +32%
```

Un camión que pasa de 32 a 42 L/100km está roto o le están sacando combustible.
En cualquiera de los dos casos conviene enterarse esta semana y no cuando cierre
el mes.

## Contra sí misma, nunca contra la flota

La mediana de la flota es 30 L/100km y la mitad central va de 20 a 33. Un tractor
cargado y una camioneta no se comparan: cualquier umbral global sería absurdo
para uno de los dos.

Cada unidad se mide contra su propio historial.

## El umbral también es propio de cada unidad

Medido sobre 63 días de datos reales con `npm run diag:combustible`, la variación
típica de una unidad contra sí misma es **±5%**. Pero el rango real va de ±1% a
±16%:

| Unidad | Variación propia | Su umbral |
|---|---|---|
| AE517UM | ± 16% | 48% |
| AH327AU | ± 8% | 24% |
| *la mayoría* | ± 3-6% | 20% |
| AH327CF | ± 1% | 20% |

```
umbral = max(UMBRAL_MIN, 3 × la variación propia de la unidad)
```

Un umbral único sería incorrecto en los dos extremos: al 20%, AE517UM avisaría
sola por su ruido normal; y para AH327CF, que oscila ±1%, un 20% deja pasar cosas
que para ese motor son enormes.

**El piso del 20% no es arbitrario:** por debajo de eso se está midiendo cuánto
se llenó el tanque, no cuánto consumió el motor.

## Cuántos avisos esperar

La simulación sobre los datos que ya existen da **como mucho 1,2 avisos por
semana**, y menos en la práctica porque las unidades ruidosas suben su propia
vara.

Eso es deliberado. Un aviso que llega todos los días se deja de leer, y una
alerta que alguien apagó es peor que no tenerla: da sensación de cobertura sin
darla.

## Solo hacia arriba

Gastar de menos no se avisa. Un consumo sospechosamente bajo casi siempre
significa que **falta registrar una carga**, no que el motor mejoró.

## Qué se descarta y por qué

Un "tramo" son los litros de una carga sobre los km recorridos desde la anterior.
No todos sirven:

| Descarte | Qué pasó | Cómo se arregla |
|---|---|---|
| odómetro para atrás | error de tipeo, o cargas fuera de orden | validando el número al cargar |
| salto > 3.000 km | falta una carga en el medio | registrando las cargas |
| consumo < 10 L/100km | ídem: los km se hicieron con combustible que no vemos | registrando las cargas |
| consumo > 120 L/100km | odómetro mal tipeado | validando el número al cargar |
| urea | no es combustible de tracción | — |

Sobre los datos de agosto de 2026, **288 de 340 tramos (85%) son utilizables**.
Los 27 errores de tipeo son evitables en el momento de la carga: el sistema ya
sabe cuál fue el odómetro anterior.

Los descartes no son "ruido a ignorar": son datos mal cargados. Contarlos como
consumo real haría que la alerta mida errores de tipeo en vez de motores.

## Lo que NO se afirma

Una unidad con menos de 5 tramos previos no se evalúa. Con menos, la mediana se
mueve tanto que cualquier cosa parece anomalía.

Y un tramo de hace más de 30 días no dispara aviso aunque esté fuera de rango: no
hay nada que investigar dos meses después, y sin esto el primer arranque
avisaría sobre toda la historia vieja de golpe.

## Por qué mediana y MAD, y no promedio y desvío estándar

Con 10 o 15 tramos, **un solo dato mal cargado mueve el promedio y dispara el
desvío estándar** lo suficiente como para esconder justo el problema siguiente.
La mediana y la desviación absoluta mediana lo ignoran.

Está fijado con un test: nueve valores idénticos más un `300` dan variación 0.

## Anti-ruido del envío

El mismo criterio que documentación y mantenimiento:

- se manda cuando **cambia** el conjunto de unidades alertadas;
- si no cambia nada, un recordatorio cada `CONSUMO_RECORDAR_DIAS`;
- solo dentro de la ventana horaria, con tope arriba **y** abajo;
- si no se pudo entregar a nadie, **no** se anota como avisado.

La firma incluye la fecha del tramo, no solo la unidad: si la misma unidad vuelve
a cargar y **sigue** alta, eso es un dato nuevo y merece avisar de nuevo.

| Variable | Default | Qué hace |
|---|---|---|
| `CONSUMO_OFF` | — | `1` desactiva el aviso |
| `CONSUMO_HORA` | `8` | inicio de la ventana |
| `CONSUMO_HORA_HASTA` | `20` | fin de la ventana |
| `CONSUMO_RECORDAR_DIAS` | `7` | recordatorio si no cambió nada |
| `CONSUMO_UMBRAL_MIN` | `20` | piso del umbral, en % |
| `CONSUMO_ROLES` | `dueno,gerencia,jefe_mantenimiento` | a quiénes avisar |

Los tres roles tienen el módulo `fuel`, así que todos pueden abrir la pantalla a
la que lleva el aviso. Mandar un aviso hacia una pantalla que el destinatario no
puede abrir sería peor que no mandarlo.

## Volver a medir

`npm run diag:combustible` es de solo lectura y se puede correr contra producción
cuando sea. Sirve para tres cosas:

1. Ver si la variación de la flota cambió (y con ella el umbral que corresponde).
2. Encontrar unidades que se mueven mucho más que el resto — o tienen cargas mal
   registradas, o algo real ya está pasando.
3. Simular qué habría hecho cada umbral sobre los datos que ya existen, antes de
   cambiarlo.

## Lo que esto todavía no hace

- **No hay pantalla.** Solo el aviso. Ver el consumo de cada unidad y su historia
  requiere correr el diagnóstico.
- **No valida el odómetro al cargar**, que es lo que eliminaría la mayoría de los
  27 errores de tipeo en origen.
- **La línea de base es todo el historial previo**, no una ventana móvil. Es más
  estable, pero tarda más en adaptarse a un cambio legítimo (ruta nueva, otro
  tipo de carga). Se eligió así para que coincida con la simulación del
  diagnóstico y la predicción de volumen siga siendo válida.
