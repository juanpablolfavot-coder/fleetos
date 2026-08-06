#!/usr/bin/env python3
"""
Verifica y extrae los km de un informe "Información de viajes" de Powerfleet.
────────────────────────────────────────────────────────────────────────────────
Es la herramienta con la que se sacaron los números de scripts/backfill-gps-km.js.
Queda en el repo para que cualquiera pueda rehacer la cuenta sobre el mismo PDF y
llegar al mismo número, o repetirla con un informe nuevo.

Qué hace, en orden:
  1. Saca el texto del PDF (descomprime los streams; no necesita ninguna librería).
  2. Lee la tabla resumen: patente, cantidad de viajes y km de cada unidad.
  3. Lee el detalle: cada viaje con su fecha/hora de inicio, de fin y su distancia.
  4. VERIFICA que cada unidad cierre —que la cantidad de viajes del detalle y la
     suma de sus distancias den lo mismo que dice el resumen— y que la suma de las
     unidades dé el "Distancia Total" que el informe declara. Si algo no cierra,
     lo dice: sin ese chequeo el número no vale nada.
  5. Con --desde/--hasta, suma sólo los viajes iniciados en ese rango. Sirve para
     recortar un informe que se pasa de mes (el de junio llegaba hasta el 05 y del
     05 en adelante ya lo cubría otra exportación).

Uso:
  python3 scripts/verificar-informe-viajes.py informe.pdf julio
  python3 scripts/verificar-informe-viajes.py informe.pdf junio-1a4 2026-06-01 2026-06-04

Deja un km-<etiqueta>.json con el km por patente.
"""

import re, zlib, sys, json

DT = re.compile(r'^(\d{2})/(\d{2})/(\d{4}) \d{1,2}:\d{2}:\d{2}$')

def literales(pdf):
    d = open(pdf,'rb').read(); out=[]
    for m in re.finditer(rb'stream\r?\n', d):
        s=m.end(); e=d.find(b'endstream', s)
        if e<0: continue
        try: raw=zlib.decompress(d[s:e])
        except Exception: continue
        if b'Tj' not in raw and b'TJ' not in raw: continue
        out.append(raw.decode('latin-1'))
    txt='\n'.join(out)
    return [m.group(1) for m in re.finditer(r'\(([^)]*)\) Tj', txt)]

def parse(pdf):
    L = literales(pdf)
    # total declarado por el informe
    decl = None
    for i,l in enumerate(L):
        if l=='Distancia Total':
            for j in range(i+1, min(i+12, len(L))):
                m = re.match(r'^(\d+) kilometros$', L[j].strip())
                if m: decl = int(m.group(1)); break
        if decl is not None: break
    # resumen: [+] patente ... viajes distancia
    res=[]
    for i,l in enumerate(L):
        if l=='[+]':
            pat=L[i+1].strip(); j=i+2
            while j<len(L) and not L[j].strip().isdigit(): j+=1
            res.append((pat,int(L[j]),int(L[j+1])))
    # detalle por unidad, mismo orden
    idx=[i for i,l in enumerate(L) if l=='Comienzo']
    bloques=[]
    for k,st in enumerate(idx):
        seg = L[st: idx[k+1] if k+1<len(idx) else len(L)]
        trips=[]
        for i in range(len(seg)-2):
            m1,m2 = DT.match(seg[i].strip()), DT.match(seg[i+1].strip())
            if m1 and m2 and seg[i+2].strip().isdigit():
                trips.append((f"{m1.group(3)}-{m1.group(2)}-{m1.group(1)}", int(seg[i+2])))
        bloques.append(trips)
    return decl, res, bloques

if __name__ == '__main__':
    pdf, etiqueta = sys.argv[1], sys.argv[2]
    desde = sys.argv[3] if len(sys.argv)>3 else None
    hasta = sys.argv[4] if len(sys.argv)>4 else None
    decl,res,bl = parse(pdf)
    if len(res)!=len(bl):
        print(f"⚠ {etiqueta}: {len(res)} unidades en el resumen pero {len(bl)} bloques de detalle"); sys.exit(1)
    fechas=[f for t in bl for f,_ in t]
    malas=[]; km={}
    for (pat,v,d),trips in zip(res,bl):
        if len(trips)!=v or sum(x for _,x in trips)!=d: malas.append(f"{pat}({len(trips)}/{v}, {sum(x for _,x in trips)}/{d})")
        sel=[x for f,x in trips if (not desde or f>=desde) and (not hasta or f<=hasta)]
        km[pat]=sum(sel)
    tot=sum(d for _,_,d in res)
    print(f"\n=== {etiqueta} ===")
    print(f"cobertura real: {min(fechas)} → {max(fechas)}   ({len(res)} unidades)")
    print(f"total informe: {tot:,}  declarado: {decl if decl is not None else 'n/d'}  {'✓' if tot==decl else '⚠ NO COINCIDE'}".replace(',','.'))
    print(f"unidades que reconcilian viaje por viaje: {len(res)-len(malas)}/{len(res)} {'✓' if not malas else '⚠ '+', '.join(malas)}")
    if desde or hasta:
        print(f"recorte {desde or '…'} → {hasta or '…'}: {sum(km.values()):,} km".replace(',','.'))
    json.dump(km, open(f'km-{etiqueta}.json','w'))
