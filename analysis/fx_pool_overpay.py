# Shadow mode: for every real swap on today's FX pools, what did the user pay vs the real FX rate, and
# what would a basket wallet quoting at (rate - OUR_BPS) have saved them?
import json,urllib.request,time,bisect,datetime,sys
OUR_BPS=float(sys.argv[1]) if len(sys.argv)>1 else 6.0
UA={"User-Agent":"Mozilla/5.0","Accept":"application/json"}
def get(u):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40))
        except Exception: time.sleep(3+i*3)
def fx(sym):   # Yahoo 1-minute FX, USD per 1 unit of currency
    y=get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=7d")
    r=y["chart"]["result"][0]; pts=[(t,c) for t,c in zip(r["timestamp"],r["indicators"]["quote"][0]["close"]) if c]
    return pts
POOLS=[("eth","JPYC","JPY=X",True),("eth","EURC","EURUSD=X",False),("base","EURC","EURUSD=X",False),("base","XSGD","SGD=X",True),("base","ZCHF","CHF=X",True),("base","AUDD","AUDUSD=X",False)]
# find the top pools per token (by 24h volume) against USDC
TOK={("eth","JPYC"):"0xe7c3d8c9a439fede00d2600032d5db0be71c3c29",("eth","EURC"):"0x1abaea1f7c830bd89acc67ec4af516284b1bc33c",("base","EURC"):"0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
     ("base","XSGD"):"0x0a4c9cb2778ab3302996a34befcf9a8bc288c33b",("base","ZCHF"):"0xd4dd9e2f021bb459d5a5f6c24c12fe09c5d45553",("base","AUDD"):"0x449b3317a6d1efb1bc3ba0700c9eaa4ffff4ae65"}
tot_vol=tot_extra=tot_n=0
for net,sym,ysym,inv in POOLS:
    ref=fx(ysym); rt=[p[0] for p in ref]
    usdper=lambda t:(lambda i:(1/ref[i][1] if inv else ref[i][1]) if i>=0 and t-ref[i][0]<=900 else None)(bisect.bisect_right(rt,t)-1)
    pl=get(f"https://api.geckoterminal.com/api/v2/networks/{net}/tokens/{TOK[(net,sym)]}/pools?page=1"); time.sleep(2.2)
    pools=[p for p in (pl or {}).get("data",[]) if "USD" in p["attributes"]["name"].split("/")[-1].upper() or "USD" in p["attributes"]["name"].split("/")[0].upper()][:3]
    vol=extra=n=0; costs=[]
    for p in pools:
        a=p["attributes"]; pid=a["address"]
        tr=get(f"https://api.geckoterminal.com/api/v2/networks/{net}/pools/{pid}/trades"); time.sleep(2.2)
        for t in (tr or {}).get("data",[]):
            x=t["attributes"]; ts=int(datetime.datetime.fromisoformat(x["block_timestamp"].replace("Z","+00:00")).timestamp())
            ref_usd=usdper(ts)
            if not ref_usd: continue
            usd=float(x["volume_in_usd"] or 0)
            if usd<50: continue
            # token amount & usd side: price paid per token in USD
            if x["kind"]=="buy":   # user bought token with USD
                tok_amt=float(x["to_token_amount"]); cost=(usd/tok_amt)/ref_usd-1
            else:
                tok_amt=float(x["from_token_amount"]); cost=1-(usd/tok_amt)/ref_usd
            bps=cost*1e4
            if abs(bps)>2000: continue
            costs.append((usd,bps)); vol+=usd; n+=1
            if bps>OUR_BPS: extra+=usd*(bps-OUR_BPS)/1e4
    if n:
        med=sorted(b for _,b in costs)[len(costs)//2]; vw=sum(u*b for u,b in costs)/vol
        big=[b for u,b in costs if u>=5000]
        print(f"{net:4} {sym:5} trades {n:4} vol ${vol:>11,.0f} | median cost {med:6.1f} bps | vol-weighted {vw:6.1f} bps | >=$5k trades {len(big)} median {sorted(big)[len(big)//2] if big else float('nan'):.1f} bps | overpaid vs {OUR_BPS:.0f}bps wallet ${extra:,.0f}")
    else: print(f"{net:4} {sym:5} no matched trades")
    tot_vol+=vol; tot_extra+=extra; tot_n+=n
print(f"TOTAL matched trades {tot_n} | volume ${tot_vol:,.0f} | users overpaid vs a {OUR_BPS:.0f} bps basket: ${tot_extra:,.0f}")
