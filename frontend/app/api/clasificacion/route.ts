import { NextResponse } from 'next/server';

export const revalidate = 0; // Disable cache

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const liga = searchParams.get('liga') || 'eng.1';
  let jornada = parseInt(searchParams.get('jornada') || '0', 10);

  const url_standings = `https://site.api.espn.com/apis/v2/sports/soccer/${liga}/standings`;
  const url_scoreboard = `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/scoreboard?dates=2026&limit=450`;
  const url_stats = `https://site.api.espn.com/apis/site/v2/sports/soccer/${liga}/statistics`;

  try {
    const [res_std, res_scb, res_sts] = await Promise.all([
      fetch(url_standings).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(url_scoreboard).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(url_stats).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    let total_jornadas = 38;
    if (liga.includes("arg") || liga.includes("mls")) total_jornadas = 27;
    if (liga.includes("ger")) total_jornadas = 34;

    let matches_per_jornada = 10;
    const grupos = [];
    
    // Parse Standings
    if (res_std?.children?.length > 0) {
      const total_teams = res_std.children.reduce((acc: number, c: any) => acc + (c.standings?.entries?.length || 0), 0);
      if (total_teams > 0) {
        matches_per_jornada = Math.floor(total_teams / 2);
      }

      res_std.children.forEach((child: any) => {
        const group_name = child.name || "Tabla";
        const group_entries = child.standings?.entries || [];
        const group_posiciones = group_entries.map((team: any) => {
          let pts = 0, pj = 0, dg = 0, g = 0, e = 0, p = 0, gol = "0:0";
          team.stats?.forEach((st: any) => {
            const sn = st.shortDisplayName;
            const val = st.value;
            if (sn === "PTS") pts = val;
            if (sn === "J") pj = val;
            if (sn === "DIF") dg = val;
            if (sn === "G") g = val;
            if (sn === "E") e = val;
            if (sn === "P") p = val;
            if (sn === "F") gol = `${val}:${team.stats.find((s:any)=>s.shortDisplayName==="C")?.value||0}`;
          });

          return {
            rank: team.stats?.find((s:any)=>s.name==="rank")?.value?.toString() || "0",
            team: team.team?.shortDisplayName || team.team?.name || "Equipo",
            logo: team.team?.logos?.[0]?.href || "",
            pts: pts.toString(),
            pj: pj.toString(),
            dg: dg.toString(),
            g: g.toString(),
            e: e.toString(),
            p: p.toString(),
            gol: gol,
            ultimas: [],
            team_id: team.team?.id
          };
        });
        grupos.push({ name: group_name, posiciones: group_posiciones });
      });
    }

    // Parse Scoreboard
    const real_form: Record<string, string[]> = {};
    let events_data: any[] = [];
    
    if (res_scb?.events?.length > 0) {
      let events = res_scb.events;
      let target_slug = null;
      for (const ev of events) {
        if (['in', 'pre'].includes(ev.status?.type?.state)) {
          target_slug = ev.season?.slug;
          break;
        }
      }
      if (!target_slug) target_slug = events[events.length - 1].season?.slug;
      
      if (target_slug) {
        events = events.filter((ev: any) => ev.season?.slug === target_slug);
      }
      
      events_data = events.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      events_data.forEach((ev: any) => {
        if (ev.status?.type?.state === "post") {
          const comp = ev.competitions?.[0];
          const competitors = comp?.competitors || [];
          if (competitors.length === 2) {
            const c1 = competitors[0];
            const c2 = competitors[1];
            const t1_id = c1.team?.id;
            const t2_id = c2.team?.id;
            const s1 = parseInt(c1.score || "0", 10);
            const s2 = parseInt(c2.score || "0", 10);
            
            if (!real_form[t1_id]) real_form[t1_id] = [];
            if (!real_form[t2_id]) real_form[t2_id] = [];
            
            if (s1 > s2) {
              real_form[t1_id].push("V");
              real_form[t2_id].push("D");
            } else if (s2 > s1) {
              real_form[t2_id].push("V");
              real_form[t1_id].push("D");
            } else {
              real_form[t1_id].push("E");
              real_form[t2_id].push("E");
            }
          }
        }
      });
    }

    // Apply real form to standings
    grupos.forEach(grupo => {
      grupo.posiciones.forEach((pos: any) => {
        if (pos.team_id && real_form[pos.team_id]) {
          // Take last 5 matches
          const form = real_form[pos.team_id].slice(-5);
          // Reverse so most recent is on the right, matching frontend expectation
          pos.ultimas = form; 
        }
      });
    });

    // Auto-advance matchday
    if (jornada <= 0) {
      let current_md = 1;
      for (let i = 0; i < events_data.length; i++) {
        const st = events_data[i].status?.type?.state;
        if (['pre', 'in'].includes(st)) {
          current_md = Math.floor(i / matches_per_jornada) + 1;
          break;
        }
      }
      jornada = current_md;
    }
    if (jornada > total_jornadas) jornada = total_jornadas;

    const start_idx = (jornada - 1) * matches_per_jornada;
    const end_idx = start_idx + matches_per_jornada;
    const events_to_show = events_data.slice(start_idx, end_idx);

    const partidos = events_to_show.map((ev: any) => {
      const comp = ev.competitions?.[0];
      const competitors = comp?.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === "home") || competitors[0];
      const away = competitors.find((c: any) => c.homeAway === "away") || competitors[1];
      
      const st = ev.status?.type?.state;
      let status_es = st;
      if (st === "pre") status_es = "Próximo";
      else if (st === "in") status_es = "En Vivo";
      else if (st === "post") status_es = "Finalizado";

      let fecha_str = ev.date;
      let hora_str = "";
      try {
        const dt = new Date(ev.date);
        const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        fecha_str = `${dias[dt.getDay()]} ${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')}`;
        hora_str = `${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
      } catch (e) {}

      return {
        id: ev.id,
        team_home: home?.team?.shortDisplayName || home?.team?.name || "Local",
        team_away: away?.team?.shortDisplayName || away?.team?.name || "Visitante",
        score_home: home?.score || "0",
        score_away: away?.score || "0",
        logo_home: home?.team?.logo || "",
        logo_away: away?.team?.logo || "",
        status: status_es,
        fecha: fecha_str,
        hora: hora_str
      };
    });

    // Parse Stats
    const estadisticas = [];
    if (res_sts?.stats?.length > 0) {
      res_sts.stats.forEach((stat_cat: any) => {
        let cat_name = stat_cat.displayName || "";
        if (cat_name === "Goals") cat_name = "Goles";
        else if (cat_name === "Assists") cat_name = "Asistencias";
        else if (cat_name === "Yellow Cards") cat_name = "Tarjetas Amarillas";
        else if (cat_name === "Red Cards") cat_name = "Tarjetas Rojas";

        const leaders = [];
        const l_list = stat_cat.leaders || [];
        for (let i = 0; i < Math.min(l_list.length, 50); i++) {
          const item = l_list[i];
          leaders.push({
            jugador: item.athlete?.displayName || "Jugador",
            logo_equipo: item.team?.logo || "",
            valor: Math.round(item.value)
          });
        }
        estadisticas.push({ categoria: cat_name, top: leaders });
      });
    }

    return NextResponse.json({
      liga_nombre: res_std?.name || "Liga",
      jornada_actual: jornada,
      total_jornadas: total_jornadas,
      grupos: grupos,
      partidos: partidos,
      estadisticas: estadisticas
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
