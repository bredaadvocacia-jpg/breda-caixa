/* Caixa Breda Advocacia v4 — SPA unificada com 3 abas e IA Gemini */
(function () {
  "use strict";

  const LS_URL = "caixaBredaApiUrl";
  const LS_TOK = "caixaBredaToken";
  const LS_CACHE = "caixaBredaCache";

  const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const state = {
    apiUrl: localStorage.getItem(LS_URL) || "",
    token: localStorage.getItem(LS_TOK) || "",
    entradas: [],
    saidas: [],
    abaAtiva: location.hash.replace("#", "") || "insights",
    filtroAno: null,
    filtroMes: null,
    filtroCategoria: null,
    filtroBusca: "",
    filtroTipos: { entrada: true, saida: true },
    filtroDataDe: "",
    filtroDataAte: "",
    anoAnalise: new Date().getFullYear(),
    anexosPendentes: [],
    charts: {},
    chatHistorico: [],
  };

  // ====== HELPERS ======
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmtBRL = (n) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBRLk = (n) => {
    const a = Math.abs(n || 0);
    if (a >= 1e6) return "R$ " + (n / 1e6).toFixed(2).replace(".", ",") + "M";
    if (a >= 1e3) return "R$ " + (n / 1e3).toFixed(1).replace(".", ",") + "k";
    return "R$ " + (n || 0).toFixed(0);
  };
  const fmtData = (iso) => iso ? iso.split("-").reverse().join("/") : "—";
  const fmtBytes = (n) => n < 1024 ? n + "B" : n < 1024*1024 ? (n/1024).toFixed(1)+"KB" : (n/1024/1024).toFixed(1)+"MB";
  const escapeHtml = (s) => s == null ? "" : String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const toast = (msg, err) => {
    const el = $("#toast"); el.textContent = msg; el.classList.toggle("err", !!err);
    el.classList.add("show"); clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  };

  // ====== API ======
  async function apiGet(params = {}) {
    if (!state.apiUrl || !state.token) throw new Error("Faça login.");
    const url = new URL(state.apiUrl);
    url.searchParams.set("token", state.token);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const r = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || "Erro na API");
    return data;
  }
  async function apiPost(acao, body = {}) {
    if (!state.apiUrl || !state.token) throw new Error("Faça login.");
    const r = await fetch(state.apiUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ acao, token: state.token }, body)),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || "Erro na API");
    return data;
  }

  // ====== LOGIN 2FA ======
  function abrirLogin(msg) {
    setLoginStep(1);
    if (msg) {
      const el = $("#login-msg");
      el.textContent = msg;
      el.classList.toggle("err", msg.toLowerCase().includes("inválid") || msg.toLowerCase().includes("erro") || msg.startsWith("❌"));
    } else {
      $("#login-msg").textContent = "";
      $("#login-msg").className = "login-msg";
    }
    $("#login-url").value = state.apiUrl;
    $("#login-senha").value = "";
    $("#login-codigo").value = "";
    $("#login-overlay").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function fecharLogin() {
    $("#login-overlay").classList.remove("open");
    document.body.style.overflow = "";
  }

  function setLoginStep(n) {
    $("#login-step1").style.display = n === 1 ? "block" : "none";
    $("#login-step2").style.display = n === 2 ? "block" : "none";
  }

  async function loginStep1(ev) {
    ev.preventDefault();
    const url = $("#login-url").value.trim();
    const senha = $("#login-senha").value.trim();
    if (!url || !senha) {
      $("#login-msg").textContent = "Preencha URL e senha.";
      $("#login-msg").className = "login-msg err";
      return;
    }
    state.apiUrl = url;
    state._loginSenha = senha;  // guarda temporariamente até step2
    const msg = $("#login-msg"); msg.className = "login-msg"; msg.textContent = "Enviando código…";
    try {
      const r = await fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ acao: "login-step1", senha: senha }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.erro || "Erro");
      state._codeId = data.codeId;
      localStorage.setItem(LS_URL, url);
      setLoginStep(2);
      msg.textContent = "Código enviado para " + (state._emailMascarado || "seu e-mail") + ". Verifique a caixa de entrada.";
      $("#login-codigo").focus();
    } catch (err) {
      msg.textContent = "❌ " + err.message;
      msg.className = "login-msg err";
    }
  }

  async function loginStep2(ev) {
    ev.preventDefault();
    const codigo = $("#login-codigo").value.trim();
    if (!/^\d{6}$/.test(codigo)) {
      $("#login-msg").textContent = "Digite o código de 6 dígitos.";
      $("#login-msg").className = "login-msg err";
      return;
    }
    const msg = $("#login-msg"); msg.className = "login-msg"; msg.textContent = "Validando…";
    try {
      // Captura informação do dispositivo para registro
      const dispositivo = (navigator.userAgentData && navigator.userAgentData.platform)
        || (/iPhone|iPad/.test(navigator.userAgent) ? "iOS"
           : /Android/.test(navigator.userAgent) ? "Android"
           : /Mac/.test(navigator.userAgent) ? "Mac"
           : /Windows/.test(navigator.userAgent) ? "Windows"
           : "Desconhecido");
      const r = await fetch(state.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ acao: "login-step2", codeId: state._codeId, codigo: codigo, dispositivo: dispositivo + " · " + navigator.language }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.erro || "Erro");
      state.token = data.token;
      localStorage.setItem(LS_TOK, data.token);
      state._loginSenha = null;
      state._codeId = null;
      fecharLogin();
      carregarTudo();
    } catch (err) {
      msg.textContent = "❌ " + err.message;
      msg.className = "login-msg err";
    }
  }

  async function reenviarCodigo() {
    if (!state._loginSenha) { setLoginStep(1); return; }
    const msg = $("#login-msg"); msg.className = "login-msg"; msg.textContent = "Reenviando…";
    try {
      const r = await fetch(state.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ acao: "login-step1", senha: state._loginSenha }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.erro || "Erro");
      state._codeId = data.codeId;
      msg.textContent = "✓ Novo código enviado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
      msg.className = "login-msg err";
    }
  }

  async function logout() {
    try { await apiPost("logout"); } catch (e) {}
    localStorage.removeItem(LS_TOK);
    state.token = "";
    state.entradas = []; state.saidas = [];
    abrirLogin("Sessão encerrada.");
  }

  // ====== CARREGAR DADOS ======
  async function carregarTudo() {
    try {
      const r = await apiGet({ aba: "painel" });
      state.entradas = r.entradas || [];
      state.saidas = r.saidas || [];
      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), e: state.entradas, s: state.saidas }));
    } catch (err) {
      if (/senha|inválid|token|login/i.test(err.message)) { abrirLogin(err.message); return; }
      const c = localStorage.getItem(LS_CACHE);
      if (c) {
        const d = JSON.parse(c);
        state.entradas = d.e || []; state.saidas = d.s || [];
        toast("API indisponível — usando cache.", true);
      } else {
        toast(err.message, true);
      }
    }
    popularFiltros();
    renderTodasAbas();
    state._previsaoLoaded = false;  // permite recarregar previsão pós-login
    carregarIA();
    if (state.abaAtiva === "analise") carregarPrevisao();
  }

  async function carregarIA() {
    if (!state.apiUrl || !state.token) return;
    // Resumo
    apiGet({ aba: "ia", acao: "resumo" }).then(r => {
      const texto = r.texto || "(sem resposta)";
      $("#resumo-ia").innerHTML = formatarResumo(texto);
    }).catch(err => {
      $("#resumo-ia").innerHTML = `<span class="ai-loading">IA indisponível: ${escapeHtml(err.message)}</span>`;
    });

    // Alertas
    apiGet({ aba: "ia", acao: "alertas" }).then(r => {
      const wrap = $("#alertas");
      const meta = $("#alertas-meta");
      const list = r.alertas || [];
      if (list.length === 0) {
        wrap.innerHTML = `<div class="alert empty"><span class="alert-icon">✓</span><span>Nenhuma anomalia relevante detectada nos últimos meses.</span></div>`;
        meta.textContent = "0 alertas";
      } else {
        wrap.innerHTML = list.map(a => renderAlerta(a)).join("");
        meta.textContent = list.length + " alerta" + (list.length === 1 ? "" : "s");
      }
    }).catch(err => {
      $("#alertas").innerHTML = `<div class="alert"><span class="alert-icon">!</span><span>IA indisponível: ${escapeHtml(err.message)}</span></div>`;
      $("#alertas-meta").textContent = "—";
    });

    // Previsão (só dispara quando entrar na tab Análise)
  }

  // ====== FORMATADORES DE SAÍDA IA ======
  const ALERTA_LABELS = {
    GASTO_ACIMA:      { label: "Gasto acima da média",      tom: "neg",  emoji: "↑" },
    RECEITA_AUSENTE:  { label: "Receita recorrente faltando", tom: "warn", emoji: "—" },
    GASTO_NOVO:       { label: "Gasto novo atípico",         tom: "warn", emoji: "+" },
    QUEDA_RECEITA:    { label: "Queda de receita",           tom: "neg",  emoji: "↓" },
    ALERTA:           { label: "Alerta",                     tom: "warn", emoji: "!" },
  };

  function mesPt(ym) {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "";
    const [y, m] = ym.split("-");
    return `${MESES_PT[parseInt(m,10)-1]} ${y}`;
  }

  function renderAlerta(a) {
    // Suporta formato JSON novo {tipo, mes, valor, categoria, comparativo, descricao}
    // ou string crua antiga (fallback do backend)
    if (typeof a === "string") {
      // tenta parsear "TIPO: descrição (valor)"
      const m = a.match(/^([A-Z_]+):\s*(.+?)(?:\s*\(([\d.]+)\))?$/);
      if (m) a = { tipo: m[1], descricao: m[2], valor: m[3] ? parseFloat(m[3]) : null };
      else a = { tipo: "ALERTA", descricao: a };
    }
    const meta = ALERTA_LABELS[a.tipo] || ALERTA_LABELS.ALERTA;
    const mes = a.mes ? mesPt(a.mes) : "";
    const cat = a.categoria ? ` · <span class="alert-cat">${escapeHtml(a.categoria)}</span>` : "";
    const valor = (a.valor || a.valor === 0) ? `<span class="alert-valor ${meta.tom}">${fmtBRL(a.valor)}</span>` : "";
    const comp = (a.comparativo || a.comparativo === 0)
      ? `<span class="alert-comp">vs ${fmtBRL(a.comparativo)}</span>` : "";
    const desc = escapeHtml(a.descricao || "");

    return `
      <div class="alert alert-${meta.tom}">
        <span class="alert-tag alert-tag-${meta.tom}">${meta.emoji} ${meta.label}</span>
        <div class="alert-body">
          <div class="alert-desc">${desc}${cat}</div>
          <div class="alert-numbers">
            ${mes ? `<span class="alert-mes">${escapeHtml(mes)}</span>` : ""}
            ${valor}
            ${comp}
          </div>
        </div>
      </div>
    `;
  }

  /** Pega o texto cru do resumo e melhora formatação:
   *  - converte YYYY-MM em "Mês YYYY"
   *  - destaca valores em R$
   *  - quebra parágrafos por linha em branco
   *  - escapa HTML antes de aplicar transformações
   */
  function formatarResumo(txt) {
    let t = escapeHtml(txt);
    // YYYY-MM → Mês YYYY
    t = t.replace(/(\d{4})-(\d{2})/g, (_, y, m) => {
      const idx = parseInt(m, 10) - 1;
      if (idx < 0 || idx > 11) return `${y}-${m}`;
      return `${MESES_PT[idx]} ${y}`;
    });
    // Valores soltos "R$ X.XXX,XX" e "X.XXX,XX" — destacar em bold
    t = t.replace(/(R\$\s?[\d.]+,\d{2})/g, '<strong class="resumo-num">$1</strong>');
    // Percentuais
    t = t.replace(/([+-]?\d+[,.]\d+%)/g, '<strong class="resumo-pct">$1</strong>');
    // Quebras de parágrafo
    const paragrafos = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return paragrafos.map(p => `<p>${p.replace(/\n/g, " ")}</p>`).join("");
  }

  async function carregarPrevisao() {
    // Não faz nada se ainda não logou — quando logar, o carregarTudo reseta a flag
    if (!state.apiUrl || !state.token) return;
    const wrap = $("#forecast-grid");
    wrap.innerHTML = `<div class="forecast-month"><div class="forecast-mes">Gerando previsão…</div></div>`;
    try {
      const r = await apiGet({ aba: "ia", acao: "previsao" });
      const meses = (r.previsao && r.previsao.meses) || [];
      if (!meses.length) {
        wrap.innerHTML = `<div class="forecast-month"><div class="forecast-mes">—</div><div class="forecast-notas">${escapeHtml(r.previsao && r.previsao.erro || "Sem dados suficientes")}</div></div>`;
        state._previsaoLoaded = true;
        return;
      }
      wrap.innerHTML = meses.map(m => {
        const [yy, mm] = (m.mes || "—").split("-");
        const label = mm ? `${MESES_PT[parseInt(mm,10)-1]} ${yy}` : (m.mes || "—");
        const saldo = (m.receita || 0) - (m.despesa || 0);
        return `
          <div class="forecast-month">
            <div class="forecast-mes">${escapeHtml(label)}</div>
            <div class="forecast-row"><span class="lbl">Receita</span><span class="val pos">${fmtBRL(m.receita || 0)}</span></div>
            <div class="forecast-row"><span class="lbl">Despesa</span><span class="val neg">${fmtBRL(m.despesa || 0)}</span></div>
            <div class="forecast-row"><span class="lbl">Saldo</span><span class="val ${saldo >= 0 ? 'pos' : 'neg'}">${fmtBRL(saldo)}</span></div>
            ${m.notas ? `<div class="forecast-notas">${escapeHtml(m.notas)}</div>` : ""}
          </div>`;
      }).join("");
      state._previsaoLoaded = true;  // só marca como carregado em caso de sucesso
    } catch (err) {
      state._previsaoLoaded = false;  // permite retry
      wrap.innerHTML = `<div class="forecast-month" style="grid-column:1/-1; text-align:center; padding:24px"><div class="forecast-mes">IA indisponível</div><div class="forecast-notas" style="border:none; margin-top:8px">${escapeHtml(err.message)}</div><button class="btn btn-ghost" style="margin-top:14px" id="btn-retry-previsao">Tentar novamente</button></div>`;
      const retry = document.getElementById("btn-retry-previsao");
      if (retry) retry.addEventListener("click", carregarPrevisao);
    }
  }

  // ====== TABS ======
  function ativarTab(name) {
    state.abaAtiva = name;
    location.hash = name;
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    $$("[data-tab-content]").forEach(el => el.hidden = el.dataset.tabContent !== name);
    if (name === "analise") {
      popularSelectAno();
      renderAnalise();
      if (!state._previsaoLoaded) carregarPrevisao();  // a função só marca _previsaoLoaded em caso de sucesso
    }
  }

  // ====== RENDER ======
  function renderTodasAbas() {
    renderInsights();
    renderMovimentacoes();
    if (state.abaAtiva === "analise") renderAnalise();
  }

  function renderInsights() {
    const now = new Date();
    const yAtual = now.getFullYear();
    const mAtual = now.getMonth() + 1;
    const mAnt = mAtual === 1 ? 12 : mAtual - 1;
    const yAnt = mAtual === 1 ? yAtual - 1 : yAtual;

    const sumMes = (arr, y, m) => arr.filter(x => x.ano === y && x.mes === m && x.categoria !== "Saldo Mês Anterior")
      .reduce((s, x) => s + (x.valor || 0), 0);

    const recMes = sumMes(state.entradas, yAtual, mAtual);
    const desMes = sumMes(state.saidas, yAtual, mAtual);
    const recAnt = sumMes(state.entradas, yAnt, mAnt);
    const desAnt = sumMes(state.saidas, yAnt, mAnt);
    const saldoMes = recMes - desMes;
    const margem = recMes > 0 ? (saldoMes / recMes) * 100 : 0;

    $("#periodo-atual").textContent = `${MESES_PT[mAtual-1]} ${yAtual}`;
    $("#stat-receita-mes").textContent = fmtBRL(recMes);
    $("#stat-despesa-mes").textContent = fmtBRL(desMes);
    $("#stat-saldo-mes").textContent = fmtBRL(saldoMes);
    $("#stat-saldo-mes").className = "stat-value " + (saldoMes >= 0 ? "pos" : "neg");
    $("#stat-margem").textContent = margem.toFixed(1) + "%";
    $("#stat-margem").className = "stat-value " + (margem >= 0 ? "pos" : "neg");

    $("#stat-receita-sub").innerHTML = comparativo(recMes, recAnt, mAnt);
    $("#stat-despesa-sub").innerHTML = comparativo(desMes, desAnt, mAnt, true);
    $("#stat-saldo-sub").innerHTML = comparativo(saldoMes, recAnt - desAnt, mAnt);
  }

  function comparativo(v, ant, mAnt, invertColor) {
    if (!ant) return `<span>—</span>`;
    const diff = ((v - ant) / Math.abs(ant)) * 100;
    let cls = diff >= 0 ? "pos" : "neg";
    if (invertColor) cls = diff >= 0 ? "neg" : "pos"; // crescer despesa = ruim
    const arrow = diff >= 0 ? "↑" : "↓";
    return `<span class="${cls}">${arrow} ${Math.abs(diff).toFixed(1)}% vs ${MESES_PT[mAnt-1].slice(0,3)}</span>`;
  }

  // ====== MOVIMENTAÇÕES ======
  function popularFiltros() {
    const todos = state.entradas.concat(state.saidas);
    const anos = Array.from(new Set(todos.map(x => x.ano).filter(Boolean))).sort((a,b) => b-a);
    const selAno = $("#filtro-ano");
    selAno.innerHTML = '<option value="">Todos os anos</option>' + anos.map(a => `<option value="${a}">${a}</option>`).join("");
    const selMes = $("#filtro-mes");
    selMes.innerHTML = '<option value="">Todos os meses</option>' + MESES_PT.map((n,i) => `<option value="${i+1}">${n}</option>`).join("");
    if (state.filtroAno) selAno.value = state.filtroAno;
    if (state.filtroMes) selMes.value = state.filtroMes;
  }

  function dadosFiltrados() {
    let arr = [];
    if (state.filtroTipos.entrada) arr = arr.concat(state.entradas.map(x => Object.assign({_t: "entrada"}, x)));
    if (state.filtroTipos.saida) arr = arr.concat(state.saidas.map(x => Object.assign({_t: "saida"}, x)));
    if (state.filtroAno) arr = arr.filter(x => x.ano == state.filtroAno);
    if (state.filtroMes) arr = arr.filter(x => x.mes == state.filtroMes);
    if (state.filtroCategoria) arr = arr.filter(x => x.categoria === state.filtroCategoria);
    if (state.filtroBusca) {
      const q = state.filtroBusca.toLowerCase();
      arr = arr.filter(x => (x.descricao || "").toLowerCase().includes(q));
    }
    // Range de datas (ISO YYYY-MM-DD) — string compare funciona
    if (state.filtroDataDe) arr = arr.filter(x => (x.data || "") >= state.filtroDataDe);
    if (state.filtroDataAte) arr = arr.filter(x => (x.data || "") <= state.filtroDataAte);
    return arr;
  }

  function renderMovimentacoes() {
    // Chips: tipos (já estão no HTML, só atualizar visual)
    $$(".chip[data-tipo]").forEach(btn => {
      btn.classList.toggle("active", !!state.filtroTipos[btn.dataset.tipo]);
    });

    // Chips de categoria
    const filtrados = dadosFiltrados();
    const cats = Array.from(new Set([...state.entradas, ...state.saidas].map(x => x.categoria))).sort();
    const wrap = $("#chips-categorias");
    wrap.innerHTML = cats.map(c => `<button class="chip ${state.filtroCategoria === c ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");
    $$(".chip[data-cat]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.filtroCategoria = state.filtroCategoria === btn.dataset.cat ? null : btn.dataset.cat;
        renderMovimentacoes();
      });
    });

    // Tabela
    const ordenados = filtrados.slice().sort((a,b) => (b.data || "0").localeCompare(a.data || "0"));
    const tbody = $("#tabela-body");
    if (ordenados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><h3>Sem lançamentos</h3><p>Ajuste os filtros ou crie um novo.</p></div></td></tr>`;
    } else {
      tbody.innerHTML = ordenados.slice(0, 500).map(x => {
        const tem = Array.isArray(x.anexos) && x.anexos.length;
        const clip = tem ? `<span class="clip-icon">📎 ${x.anexos.length}</span>` : "";
        const isEntrada = x._t === "entrada";
        return `
          <tr data-id="${escapeHtml(x.id)}" data-tipo="${x._t}">
            <td class="col-data">${fmtData(x.data)}</td>
            <td><span class="pill ${isEntrada ? 'pill-entrada' : 'pill-saida'}">${isEntrada ? "↑" : "↓"}</span></td>
            <td class="col-desc">${escapeHtml(x.descricao)} ${clip}</td>
            <td><span class="pill">${escapeHtml(x.categoria || "—")}</span></td>
            <td class="col-valor ${isEntrada ? 'pos' : 'neg'}">${isEntrada ? "+" : "−"} ${fmtBRL(x.valor)}</td>
          </tr>`;
      }).join("");
      $$("#tabela-body tr").forEach(tr => {
        tr.addEventListener("click", () => abrirModalEdicao(tr.dataset.id, tr.dataset.tipo));
      });
    }

    const totRec = ordenados.filter(x => x._t === "entrada").reduce((s,x) => s + (x.valor || 0), 0);
    const totDes = ordenados.filter(x => x._t === "saida").reduce((s,x) => s + (x.valor || 0), 0);
    $("#tabela-meta").innerHTML = `${ordenados.length} lançamento${ordenados.length===1?"":"s"} · <span class="pos">${fmtBRL(totRec)}</span> em entradas · <span class="neg">${fmtBRL(totDes)}</span> em saídas${ordenados.length > 500 ? " · exibindo 500 mais recentes" : ""}`;
  }

  // ====== ANÁLISE ======
  function popularSelectAno() {
    const anos = Array.from(new Set([...state.entradas, ...state.saidas].map(x => x.ano).filter(Boolean))).sort((a,b) => b-a);
    const sel = $("#ano-analise");
    sel.innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join("");
    if (!anos.includes(state.anoAnalise)) state.anoAnalise = anos[0];
    sel.value = state.anoAnalise;
  }

  function renderAnalise() {
    const ano = state.anoAnalise;
    const e = state.entradas.filter(x => x.ano === ano && x.categoria !== "Saldo Mês Anterior");
    const s = state.saidas.filter(x => x.ano === ano);

    const rec = new Array(12).fill(0);
    const des = new Array(12).fill(0);
    e.forEach(x => x.mes >= 1 && x.mes <= 12 && (rec[x.mes-1] += x.valor || 0));
    s.forEach(x => x.mes >= 1 && x.mes <= 12 && (des[x.mes-1] += x.valor || 0));

    renderRxD(rec, des);
    renderSaldoChart(rec, des);
    renderTopCharts(e, s);
    renderTabelaMensal(rec, des);
  }

  const destroy = (k) => { if (state.charts[k]) { state.charts[k].destroy(); state.charts[k] = null; } };

  function renderRxD(rec, des) {
    destroy("rxd");
    state.charts.rxd = new Chart($("#chart-rxd").getContext("2d"), {
      type: "bar",
      data: {
        labels: MESES_PT.map(m => m.slice(0,3)),
        datasets: [
          { label: "Receitas", data: rec, backgroundColor: "rgba(61,107,90,0.85)", borderColor: "#3d6b5a", borderWidth: 1, borderRadius: 3 },
          { label: "Despesas", data: des, backgroundColor: "rgba(152,69,72,0.85)", borderColor: "#984548", borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: chartOpts(),
    });
  }

  function renderSaldoChart(rec, des) {
    const acum = []; let sum = 0;
    for (let i = 0; i < 12; i++) { sum += rec[i] - des[i]; acum.push(sum); }
    destroy("saldo");
    state.charts.saldo = new Chart($("#chart-saldo").getContext("2d"), {
      type: "line",
      data: {
        labels: MESES_PT.map(m => m.slice(0,3)),
        datasets: [{
          data: acum,
          borderColor: "#3d6b5a",
          backgroundColor: "rgba(61,107,90,0.10)",
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: "#3d6b5a",
          pointRadius: 3,
        }],
      },
      options: chartOpts({ legend: false }),
    });
  }

  function renderTopCharts(e, s) {
    const top = (arr, n=10) => {
      const b = {}; arr.forEach(x => { b[x.categoria] = (b[x.categoria] || 0) + (x.valor || 0); });
      return Object.entries(b).sort((a,b) => b[1]-a[1]).slice(0,n);
    };
    const topS = top(s, 10); const topE = top(e, 10);
    destroy("topS"); destroy("topE");
    state.charts.topS = new Chart($("#chart-top-saidas").getContext("2d"), {
      type: "bar",
      data: { labels: topS.map(x=>x[0]), datasets: [{ data: topS.map(x=>x[1]), backgroundColor: "rgba(152,69,72,0.8)", borderColor: "#984548", borderWidth: 1, borderRadius: 3 }] },
      options: chartOpts({ horizontal: true, legend: false }),
    });
    state.charts.topE = new Chart($("#chart-top-entradas").getContext("2d"), {
      type: "bar",
      data: { labels: topE.map(x=>x[0]), datasets: [{ data: topE.map(x=>x[1]), backgroundColor: "rgba(61,107,90,0.8)", borderColor: "#3d6b5a", borderWidth: 1, borderRadius: 3 }] },
      options: chartOpts({ horizontal: true, legend: false }),
    });
  }

  function chartOpts(opts = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: opts.horizontal ? "y" : "x",
      plugins: {
        legend: opts.legend === false ? { display: false } : { position: "top", labels: { font: { size: 11, family: 'Inter' }, color: "#6b7076", boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: (c) => (c.dataset.label ? c.dataset.label + ": " : "") + fmtBRL(opts.horizontal ? c.parsed.x : c.parsed.y) } },
      },
      scales: opts.horizontal ? {
        x: { ticks: { callback: v => fmtBRLk(v), font: { size: 10, family: 'Inter' }, color: "#9aa0a6" }, grid: { color: "#f3f3f1" } },
        y: { ticks: { font: { size: 11, family: 'Inter' }, color: "#6b7076" }, grid: { display: false } },
      } : {
        y: { ticks: { callback: v => fmtBRLk(v), font: { size: 10, family: 'Inter' }, color: "#9aa0a6" }, grid: { color: "#f3f3f1" } },
        x: { ticks: { font: { size: 11, family: 'Inter' }, color: "#6b7076" }, grid: { display: false } },
      },
    };
  }

  function renderTabelaMensal(rec, des) {
    const tbody = $("#tabela-mensal");
    let totR = 0, totD = 0;
    tbody.innerHTML = rec.map((r, i) => {
      const d = des[i]; const sal = r - d; const mar = r > 0 ? (sal/r*100) : 0;
      totR += r; totD += d;
      return `<tr>
        <td>${MESES_PT[i]}</td>
        <td class="col-valor pos">${fmtBRL(r)}</td>
        <td class="col-valor neg">${fmtBRL(d)}</td>
        <td class="col-valor ${sal>=0?'pos':'neg'}">${fmtBRL(sal)}</td>
        <td class="col-valor ${mar>=0?'pos':'neg'}">${mar.toFixed(1)}%</td>
      </tr>`;
    }).join("");
    const totS = totR - totD; const totM = totR > 0 ? (totS/totR*100) : 0;
    $("#tot-rec").textContent = fmtBRL(totR); $("#tot-rec").classList.add("pos");
    $("#tot-des").textContent = fmtBRL(totD); $("#tot-des").classList.add("neg");
    $("#tot-sal").textContent = fmtBRL(totS); $("#tot-sal").className = "col-valor " + (totS>=0?'pos':'neg');
    $("#tot-mar").textContent = totM.toFixed(1) + "%"; $("#tot-mar").className = "col-valor " + (totM>=0?'pos':'neg');
  }

  // ====== CHAT ======
  async function chatEnviar() {
    const input = $("#chat-input");
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    $("#chat-send").disabled = true;
    addChatMsg("user", q);
    addChatMsg("ai", "Pensando…", true);
    try {
      const r = await apiPost("ia-chat", { pergunta: q });
      removeLoadingMsg();
      addChatMsg("ai", r.resposta || "(sem resposta)");
    } catch (err) {
      removeLoadingMsg();
      addChatMsg("ai", "❌ " + err.message);
    } finally {
      $("#chat-send").disabled = false;
      input.focus();
    }
  }
  function addChatMsg(role, content, isLoading) {
    const wrap = $("#chat-log");
    const div = document.createElement("div");
    div.className = "chat-msg" + (isLoading ? " loading-msg" : "");
    div.innerHTML = `<div class="chat-role ${role}">${role === "user" ? "você" : "IA"}</div><div class="chat-content">${escapeHtml(content)}</div>`;
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  }
  function removeLoadingMsg() {
    const last = $("#chat-log .loading-msg");
    if (last) last.remove();
  }

  // ====== MODAL LANÇAMENTO ======
  function abrirModalNovo() {
    $("#modal-titulo").textContent = "Novo lançamento";
    $("#modal-form").reset();
    $("#modal-id").value = "";
    $("#modal-data").value = new Date().toISOString().slice(0,10);
    $("#modal-tipo").value = "saida";
    popularSelectCategorias("saida");
    state.anexosPendentes = [];
    renderAnexos([]);
    $("#btn-deletar").style.display = "none";
    $("#modal").classList.add("open");
  }

  function abrirModalEdicao(id, tipo) {
    const arr = tipo === "entrada" ? state.entradas : state.saidas;
    const x = arr.find(d => d.id === id);
    if (!x) return;
    $("#modal-titulo").textContent = "Editar lançamento";
    $("#modal-tipo").value = tipo;
    popularSelectCategorias(tipo);
    $("#modal-id").value = x.id;
    $("#modal-data").value = x.data || "";
    $("#modal-desc").value = x.descricao || "";
    $("#modal-valor").value = x.valor || "";
    $("#modal-cat").value = x.categoria || "";
    state.anexosPendentes = (x.anexos || []).slice();
    renderAnexos(state.anexosPendentes);
    $("#btn-deletar").style.display = "inline-block";
    $("#modal").classList.add("open");
  }

  function popularSelectCategorias(tipo) {
    const arr = tipo === "entrada" ? state.entradas : state.saidas;
    const cats = Array.from(new Set(arr.map(x => x.categoria))).sort();
    const padroes = tipo === "entrada"
      ? ["Honorários", "Sucumbência", "Reembolsos", "Rendas / Aplicações", "Outros Recebimentos"]
      : ["Despesas Fixas", "Folha (Salários)", "Impostos", "Contabilidade", "Despesas Viagens", "Despesas Carros", "Despesas Diversas", "Custas / Notificações", "Tarifas Bancárias", "Investimentos", "Retiradas (Pró-labore)", "Terreno CBA"];
    const todas = Array.from(new Set([...padroes, ...cats])).sort();
    $("#modal-cat").innerHTML = todas.map(c => `<option>${escapeHtml(c)}</option>`).join("");
  }

  // Sugestão de categoria com IA enquanto digita
  let sugTimer = null;
  function sugerirCategoria() {
    clearTimeout(sugTimer);
    const desc = $("#modal-desc").value.trim();
    if (desc.length < 5) { $("#modal-cat-hint").style.display = "none"; return; }
    sugTimer = setTimeout(async () => {
      $("#modal-cat-hint").style.display = "block";
      $("#modal-cat-hint").innerHTML = `<span style="color:var(--accent)">IA</span> sugerindo categoria…`;
      try {
        const r = await apiPost("ia-categorizar", { descricao: desc, tipo: $("#modal-tipo").value });
        if (r.categoria) {
          $("#modal-cat").value = r.categoria;
          $("#modal-cat-hint").innerHTML = `<span style="color:var(--accent)">IA</span> sugeriu: <strong>${escapeHtml(r.categoria)}</strong> · você pode trocar.`;
        }
      } catch (err) {
        $("#modal-cat-hint").style.display = "none";
      }
    }, 600);
  }

  function fecharModal() { $("#modal").classList.remove("open"); }

  // ====== ANEXOS ======
  function renderAnexos(lista) {
    const wrap = $("#modal-anexos-lista");
    if (!lista || !lista.length) {
      wrap.innerHTML = `<div class="anexos-vazio">Nenhum anexo. Use o botão abaixo.</div>`;
      return;
    }
    wrap.innerHTML = lista.map((a, i) => `
      <div class="anexo-item">
        <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="anexo-nome">${escapeHtml(a.nome)}</a>
        <span class="anexo-meta">${fmtBytes(a.tamanho)}</span>
        <button type="button" class="anexo-remover" data-i="${i}">×</button>
      </div>`).join("");
    $$(".anexo-remover").forEach(b => b.addEventListener("click", () => {
      state.anexosPendentes.splice(parseInt(b.dataset.i, 10), 1);
      renderAnexos(state.anexosPendentes);
    }));
  }

  async function uploadArquivos(files) {
    if (!files || !files.length) return;
    const status = $("#anexo-status");
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) { toast(`"${file.name}" > 25MB.`, true); continue; }
      status.textContent = `Enviando ${i+1}/${files.length}…`;
      try {
        const base64 = await fileToBase64(file);
        const r = await apiPost("upload", { arquivo: { nome: file.name, mimeType: file.type, base64 } });
        state.anexosPendentes.push(r.arquivo);
      } catch (err) { toast(`Falha em "${file.name}": ${err.message}`, true); }
    }
    status.textContent = "";
    renderAnexos(state.anexosPendentes);
  }

  function fileToBase64(file) {
    return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  }

  async function salvarLancamento(ev) {
    ev.preventDefault();
    const id = $("#modal-id").value;
    const tipo = $("#modal-tipo").value;
    const aba = tipo === "entrada" ? "entradas" : "saidas";
    const lanc = {
      data: $("#modal-data").value,
      descricao: $("#modal-desc").value.trim(),
      valor: parseFloat($("#modal-valor").value),
      categoria: $("#modal-cat").value,
      anexos: state.anexosPendentes,
    };
    if (!lanc.data || !lanc.descricao || isNaN(lanc.valor)) { toast("Preencha data, descrição e valor.", true); return; }
    try {
      if (id) {
        lanc.id = id;
        const r = await apiPost("editar", { aba, lancamento: lanc });
        const arr = tipo === "entrada" ? state.entradas : state.saidas;
        const idx = arr.findIndex(x => x.id === id);
        if (idx >= 0) arr[idx] = r.lancamento;
        toast("Lançamento atualizado.");
      } else {
        const r = await apiPost("criar", { aba, lancamento: lanc });
        const arr = tipo === "entrada" ? state.entradas : state.saidas;
        arr.push(r.lancamento);
        toast("Lançamento criado.");
      }
      fecharModal();
      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), e: state.entradas, s: state.saidas }));
      popularFiltros();
      renderTodasAbas();
    } catch (err) { toast(err.message, true); }
  }

  async function deletarLancamento() {
    const id = $("#modal-id").value;
    if (!id) return;
    const tipo = $("#modal-tipo").value;
    const aba = tipo === "entrada" ? "entradas" : "saidas";
    if (!confirm("Excluir lançamento e seus anexos? Sem desfazer.")) return;
    try {
      await apiPost("deletar", { aba, lancamento: { id } });
      if (tipo === "entrada") state.entradas = state.entradas.filter(x => x.id !== id);
      else state.saidas = state.saidas.filter(x => x.id !== id);
      toast("Removido.");
      fecharModal();
      localStorage.setItem(LS_CACHE, JSON.stringify({ ts: Date.now(), e: state.entradas, s: state.saidas }));
      renderTodasAbas();
    } catch (err) { toast(err.message, true); }
  }

  // ====== DRAWER + TROCAR SENHA ======
  async function abrirDrawer() {
    $("#drawer-url").value = state.apiUrl;
    $("#drawer").classList.add("open");
    $("#drawer-backdrop").classList.add("open");
    try {
      const r = await apiGet({ aba: "info" });
      $("#drawer-email").textContent = r.emailOwner || "—";
    } catch (e) { $("#drawer-email").textContent = "—"; }
    carregarSessoes();
  }
  function fecharDrawer() { $("#drawer").classList.remove("open"); $("#drawer-backdrop").classList.remove("open"); }

  function abrirTrocar() { $("#trocar-form").reset(); $("#trocar-msg").textContent=""; $("#trocar-msg").className="trocar-msg"; $("#trocar-modal").classList.add("open"); }
  function fecharTrocar() { $("#trocar-modal").classList.remove("open"); }
  async function salvarNovaSenha(ev) {
    ev.preventDefault();
    const atual = $("#trocar-atual").value.trim();
    const nova = $("#trocar-nova").value.trim();
    const conf = $("#trocar-confirma").value.trim();
    const msg = $("#trocar-msg"); msg.className = "trocar-msg";
    if (nova.length < 6) { msg.textContent = "Nova senha precisa ter 6+ caracteres."; msg.classList.add("err"); return; }
    if (nova !== conf) { msg.textContent = "Confirmação não bate."; msg.classList.add("err"); return; }
    if (nova === atual) { msg.textContent = "Senha nova precisa ser diferente da atual."; msg.classList.add("err"); return; }
    msg.textContent = "Enviando…";
    try {
      await apiPost("trocar-senha", { senhaAtual: atual, novaSenha: nova });
      msg.textContent = "✓ Senha alterada. Outras sessões foram revogadas."; msg.classList.add("ok");
      setTimeout(() => { fecharTrocar(); toast("Senha alterada."); }, 1600);
    } catch (err) { msg.textContent = "Erro: " + err.message; msg.classList.add("err"); }
  }

  // ====== SESSÕES ATIVAS ======
  async function carregarSessoes() {
    const wrap = $("#sessoes-lista");
    wrap.innerHTML = `<div class="anexo-status">Carregando sessões…</div>`;
    try {
      const r = await apiPost("sessoes-listar");
      const lista = r.sessoes || [];
      $("#sessoes-meta").textContent = lista.length + " sessão" + (lista.length === 1 ? "" : "ões");
      if (lista.length === 0) {
        wrap.innerHTML = `<div class="anexos-vazio">Nenhuma sessão ativa.</div>`;
        return;
      }
      wrap.innerHTML = lista.map(s => {
        const criada = new Date(s.criada).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        const ultimo = new Date(s.ultimoUso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        return `
          <div class="sessao-item ${s.atual ? 'sessao-atual' : ''}">
            <div class="sessao-info">
              <div class="sessao-disp">${escapeHtml(s.dispositivo)} ${s.atual ? '<span class="sessao-tag">esta sessão</span>' : ''}</div>
              <div class="sessao-meta">Criada: ${criada} · Último uso: ${ultimo}</div>
            </div>
            ${s.atual ? '' : `<button class="sessao-revogar" data-id="${escapeHtml(s.idHashCompleto)}" title="Revogar">×</button>`}
          </div>`;
      }).join("");
      $$(".sessao-revogar").forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Revogar essa sessão? O dispositivo será deslogado.")) return;
        try {
          await apiPost("sessao-revogar", { idHashCompleto: b.dataset.id });
          toast("Sessão revogada.");
          carregarSessoes();
        } catch (err) { toast(err.message, true); }
      }));
    } catch (err) {
      wrap.innerHTML = `<div class="anexo-status">Erro: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function revogarOutras() {
    if (!confirm("Revogar todas as outras sessões? Você continua logado neste dispositivo.")) return;
    try {
      const r = await apiPost("sessao-revogar-outras");
      toast(`${r.removidas} sessão(ões) revogada(s).`);
      carregarSessoes();
    } catch (err) { toast(err.message, true); }
  }

  // ====== REVISAR ANOMALIAS ======
  let _anomalias = [];

  async function abrirAnomalias() {
    fecharDrawer();
    $("#anomalias-modal").classList.add("open");
    $("#anomalias-status").textContent = "Carregando lançamentos anômalos…";
    $("#anomalias-tabela-wrap").style.display = "none";
    $("#anomalias-vazio").style.display = "none";
    try {
      const r = await apiPost("anomalias-revisar");
      _anomalias = r.anomalias || [];
      $("#anomalias-status").style.display = "none";
      if (_anomalias.length === 0) {
        $("#anomalias-vazio").style.display = "block";
        return;
      }
      $("#anomalias-tabela-wrap").style.display = "block";
      renderTabelaAnomalias();
    } catch (err) {
      $("#anomalias-status").innerHTML = `<span style="color:var(--neg)">Erro: ${escapeHtml(err.message)}</span>`;
    }
  }

  function renderTabelaAnomalias() {
    const tbody = $("#anomalias-tabela-body");
    tbody.innerHTML = _anomalias.map((a, i) => `
      <tr>
        <td><input type="checkbox" class="anom-check" data-i="${i}" checked /></td>
        <td class="col-data">${fmtData(a.data)}</td>
        <td class="col-desc" style="max-width:200px; font-size:12px">${escapeHtml(a.descricao)}</td>
        <td><span class="pill">${escapeHtml(a.categoria || "—")}</span></td>
        <td class="col-valor neg" style="font-size:12px">${fmtBRL(a.valorAtual)}</td>
        <td class="col-valor pos" style="font-size:13px">${fmtBRL(a.valorSugerido)}</td>
        <td style="text-align:center; font-size:11px; color:var(--ink-3); font-family:monospace">${escapeHtml(a.fator || "—")}</td>
      </tr>
    `).join("");
    $("#anom-todos").addEventListener("change", e => {
      $$(".anom-check").forEach(c => c.checked = e.target.checked);
    });
  }

  function fecharAnomalias() { $("#anomalias-modal").classList.remove("open"); }

  async function aplicarAnomalias() {
    const itens = [];
    $$(".anom-check:checked").forEach(c => {
      const a = _anomalias[parseInt(c.dataset.i, 10)];
      if (a) itens.push({ id: a.id, _tipo: a._tipo, novoValor: a.valorSugerido });
    });
    if (itens.length === 0) { toast("Nenhum lançamento marcado.", true); return; }
    if (!confirm(`Aplicar ${itens.length} correção(ões)? Os valores serão atualizados na planilha.`)) return;
    try {
      const r = await apiPost("anomalias-corrigir", { itens });
      toast(`${r.corrigidas} lançamento(s) corrigido(s).`);
      fecharAnomalias();
      carregarTudo();
    } catch (err) { toast(err.message, true); }
  }

  // ====== EXPORT ======
  function exportarCSV() {
    const arr = dadosFiltrados();
    if (!arr.length) { toast("Nada para exportar.", true); return; }
    const cols = ["data","_t","descricao","valor","categoria","ano","mes"];
    const head = ["data","tipo","descricao","valor","categoria","ano","mes"].join(";");
    const rows = arr.map(x => cols.map(c => {
      const v = x[c] == null ? "" : String(x[c]).replace(/"/g,'""');
      return /[;\n"]/.test(v) ? `"${v}"` : v;
    }).join(";"));
    const blob = new Blob(["﻿" + head + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `caixa-breda-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ====== PWA INSTALL ======
  let deferredPrompt = null;

  function setupInstall() {
    const btn = $("#btn-instalar");
    const hint = $("#instalar-hint");
    const hintTxt = $("#instalar-hint-texto");
    if (!btn) return;  // safety

    // SEMPRE exibe o botão (a UI decide o texto depois)
    btn.style.display = "block";

    // 1. Já está rodando como app instalado (standalone)
    const isStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
                       || window.navigator.standalone === true
                       || document.referrer.startsWith("android-app://");
    if (isStandalone) {
      btn.textContent = "✓ Você já está usando o app instalado";
      btn.disabled = true;
      btn.style.opacity = ".6";
      btn.style.cursor = "default";
      return;
    }

    // 2. Texto inicial (vai ser sobrescrito se o evento nativo disparar)
    btn.textContent = "📲 Instalar como app no dispositivo";

    // 3. Captura evento nativo (Chrome/Edge desktop, Chrome Android) — pode demorar
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });

    // 4. Detecção de plataforma para instruções específicas
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);
    const isChrome = /Chrome/.test(ua) && !/Edg|OPR/.test(ua);
    const isEdge = /Edg/.test(ua);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    const isMac = /Macintosh/.test(ua);

    // 5. Único handler de clique — decide o que fazer
    btn.addEventListener("click", async () => {
      // Se o evento nativo está disponível → usa
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === "accepted") {
            toast("App instalado ✓");
            btn.style.display = "none";
            hint.style.display = "none";
          }
        } catch (e) { /* user dismissed */ }
        deferredPrompt = null;
        return;
      }

      // Caso contrário, mostra instruções específicas
      hint.style.display = "block";
      let html = "";
      if (isIOS) {
        html = `<strong>iPhone / iPad:</strong> abra esta página no <strong>Safari</strong> → toque no botão <strong>Compartilhar</strong> (quadrado com ↑) na barra inferior → role e toque em <strong>Adicionar à Tela de Início</strong>.`;
      } else if (isAndroid) {
        html = `<strong>Android (Chrome):</strong> abra o menu (⋮) → toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>. Se não aparecer, atualize a página e tente novamente.`;
      } else if (isSafari && isMac) {
        html = `<strong>Safari no Mac:</strong> menu <strong>Arquivo → Adicionar à Dock…</strong>. Para uma instalação mais robusta, use Chrome ou Edge.`;
      } else if (isChrome || isEdge) {
        html = `<strong>${isEdge ? "Edge" : "Chrome"}:</strong> na barra de endereço, do lado direito do ⭐, clique no ícone <strong>🖥️↓ "Instalar app"</strong>. Se não aparecer, abra o menu (⋮) e procure por <strong>"Instalar Caixa Breda"</strong> ou <strong>"Apps → Instalar este site como app"</strong>.<br><br>Se nada aparecer mesmo assim, use o app por aqui mesmo — funciona idêntico.`;
      } else {
        html = `<strong>Para instalar:</strong> use <strong>Chrome</strong> ou <strong>Edge</strong> (PC), <strong>Safari</strong> (iPhone/Mac) ou <strong>Chrome</strong> (Android). Cada um tem seu menu específico — basta procurar por "Instalar app" ou "Adicionar à tela inicial".`;
      }
      hintTxt.innerHTML = html;
    });
  }

  // ====== INIT ======
  function bindEvents() {
    $$(".tab").forEach(t => t.addEventListener("click", () => ativarTab(t.dataset.tab)));

    // Movimentações
    $("#filtro-ano").addEventListener("change", e => { state.filtroAno = e.target.value || null; renderMovimentacoes(); });
    $("#filtro-mes").addEventListener("change", e => { state.filtroMes = e.target.value || null; renderMovimentacoes(); });
    $("#filtro-busca").addEventListener("input", e => { state.filtroBusca = e.target.value; renderMovimentacoes(); });
    $("#btn-limpar").addEventListener("click", () => {
      state.filtroAno=null; state.filtroMes=null; state.filtroCategoria=null; state.filtroBusca="";
      state.filtroTipos = {entrada:true, saida:true};
      state.filtroDataDe = ""; state.filtroDataAte = "";
      $("#filtro-ano").value=""; $("#filtro-mes").value=""; $("#filtro-busca").value="";
      $("#filtro-data-de").value=""; $("#filtro-data-ate").value="";
      renderMovimentacoes();
    });
    $("#btn-exportar").addEventListener("click", exportarCSV);

    // Período (range de datas)
    $("#filtro-data-de").addEventListener("change", e => { state.filtroDataDe = e.target.value; renderMovimentacoes(); });
    $("#filtro-data-ate").addEventListener("change", e => { state.filtroDataAte = e.target.value; renderMovimentacoes(); });

    // Presets de período
    $$(".btn-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        const hoje = new Date();
        const fmt = (d) => d.toISOString().slice(0, 10);
        let de = "", ate = "";
        switch (btn.dataset.preset) {
          case "30d": {
            const ini = new Date(hoje); ini.setDate(ini.getDate() - 30);
            de = fmt(ini); ate = fmt(hoje); break;
          }
          case "90d": {
            const ini = new Date(hoje); ini.setDate(ini.getDate() - 90);
            de = fmt(ini); ate = fmt(hoje); break;
          }
          case "ano": {
            de = hoje.getFullYear() + "-01-01"; ate = hoje.getFullYear() + "-12-31"; break;
          }
          case "anoant": {
            const y = hoje.getFullYear() - 1;
            de = y + "-01-01"; ate = y + "-12-31"; break;
          }
          case "tudo": { de = ""; ate = ""; break; }
        }
        state.filtroDataDe = de; state.filtroDataAte = ate;
        $("#filtro-data-de").value = de; $("#filtro-data-ate").value = ate;
        if (de || ate) {
          state.filtroAno = null; state.filtroMes = null;
          $("#filtro-ano").value = ""; $("#filtro-mes").value = "";
        }
        renderMovimentacoes();
      });
    });
    $$(".chip[data-tipo]").forEach(btn => btn.addEventListener("click", () => {
      state.filtroTipos[btn.dataset.tipo] = !state.filtroTipos[btn.dataset.tipo];
      renderMovimentacoes();
    }));

    // Análise
    $("#ano-analise").addEventListener("change", e => { state.anoAnalise = parseInt(e.target.value,10); renderAnalise(); });

    // Modal
    $("#fab-novo").addEventListener("click", abrirModalNovo);
    $("#btn-fechar-modal").addEventListener("click", fecharModal);
    $("#btn-cancelar").addEventListener("click", fecharModal);
    $("#btn-deletar").addEventListener("click", deletarLancamento);
    $("#modal-form").addEventListener("submit", salvarLancamento);
    $("#modal").addEventListener("click", e => { if (e.target.id === "modal") fecharModal(); });
    $("#modal-anexo-input").addEventListener("change", e => { uploadArquivos(Array.from(e.target.files)); e.target.value=""; });
    $("#modal-desc").addEventListener("input", sugerirCategoria);
    $("#modal-tipo").addEventListener("change", () => popularSelectCategorias($("#modal-tipo").value));

    // Drawer
    $("#btn-config").addEventListener("click", abrirDrawer);
    $("#btn-fechar-drawer").addEventListener("click", fecharDrawer);
    $("#drawer-backdrop").addEventListener("click", fecharDrawer);
    $("#btn-logout").addEventListener("click", () => { fecharDrawer(); logout(); });
    $("#btn-recarregar").addEventListener("click", () => { carregarTudo(); state._previsaoLoaded = false; });

    // Trocar senha
    $("#btn-trocar-senha").addEventListener("click", () => { fecharDrawer(); abrirTrocar(); });
    $("#btn-fechar-trocar").addEventListener("click", fecharTrocar);
    $("#btn-cancelar-trocar").addEventListener("click", fecharTrocar);
    $("#trocar-form").addEventListener("submit", salvarNovaSenha);
    $("#trocar-modal").addEventListener("click", e => { if (e.target.id === "trocar-modal") fecharTrocar(); });

    // Chat
    $("#chat-send").addEventListener("click", chatEnviar);
    $("#chat-input").addEventListener("keydown", e => { if (e.key === "Enter") chatEnviar(); });

    // Login 2FA
    $("#login-step1").addEventListener("submit", loginStep1);
    $("#login-step2").addEventListener("submit", loginStep2);
    $("#login-reenviar").addEventListener("click", reenviarCodigo);
    $("#login-voltar").addEventListener("click", () => setLoginStep(1));

    // Sessões
    $("#btn-revogar-outras").addEventListener("click", revogarOutras);

    // Revisar anomalias
    $("#btn-revisar-anomalias").addEventListener("click", abrirAnomalias);
    $("#btn-fechar-anomalias").addEventListener("click", fecharAnomalias);
    $("#btn-cancelar-anomalias").addEventListener("click", fecharAnomalias);
    $("#btn-aplicar-anomalias").addEventListener("click", aplicarAnomalias);
    $("#btn-anom-sel-todos").addEventListener("click", () => { $$(".anom-check").forEach(c => c.checked = true); $("#anom-todos").checked = true; });
    $("#btn-anom-desel-todos").addEventListener("click", () => { $$(".anom-check").forEach(c => c.checked = false); $("#anom-todos").checked = false; });
    $("#anomalias-modal").addEventListener("click", e => { if (e.target.id === "anomalias-modal") fecharAnomalias(); });

    // Tab inicial via hash
    window.addEventListener("hashchange", () => {
      const tab = location.hash.replace("#","") || "insights";
      if (["insights","movimentacoes","analise"].includes(tab)) ativarTab(tab);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    setupInstall();
    ativarTab(state.abaAtiva);

    if (!state.apiUrl || !state.token) { abrirLogin("Configure URL e senha."); return; }
    carregarTudo();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./assets/sw.js").then((reg) => {
        // Detecta atualização do SW e oferece reload
        if (reg.waiting) notificarAtualizacao();
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              notificarAtualizacao();
            }
          });
        });
      }).catch(() => {});
    }
  });

  function notificarAtualizacao() {
    const el = $("#toast");
    el.innerHTML = `Nova versão disponível. <a href="#" id="link-recarregar" style="color:var(--gold); text-decoration:underline; margin-left:8px">Recarregar</a>`;
    el.classList.remove("err");
    el.classList.add("show");
    setTimeout(() => {
      const link = document.getElementById("link-recarregar");
      if (link) link.addEventListener("click", (e) => { e.preventDefault(); location.reload(); });
    }, 0);
  }
})();
