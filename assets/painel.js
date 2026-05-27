/* Painel Anual Consolidado — entradas × saídas × saldo */
(function () {
  "use strict";

  const LS_KEY_URL = "caixaBredaApiUrl";
  const LS_KEY_TOKEN = "caixaBredaToken";
  const LS_KEY_CACHE = "caixaBredaCache_painel";

  const MESES_PT = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  const state = {
    entradas: [],
    saidas: [],
    anoSelecionado: new Date().getFullYear(),
    apiUrl: localStorage.getItem(LS_KEY_URL) || "",
    token: localStorage.getItem(LS_KEY_TOKEN) || "",
    charts: {},
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmtBRL = (n) => "R$ " + (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBRLk = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return n.toFixed(0);
  };
  const toast = (msg, isError) => {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("err", !!isError);
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  };

  // ----------------- API -----------------
  async function apiFetch() {
    if (!state.apiUrl || !state.token) throw new Error("Faça login.");
    const url = new URL(state.apiUrl);
    url.searchParams.set("token", state.token);
    url.searchParams.set("aba", "painel");
    const r = await fetch(url.toString(), { method: "GET", redirect: "follow" });
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || "Erro na API");
    return data;
  }

  // ----------------- LOGIN -----------------
  function abrirLogin(msg) {
    if (msg) $("#login-msg").textContent = msg;
    $("#login-url").value = state.apiUrl;
    $("#login-senha").value = "";
    $("#login-overlay").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function fecharLogin() {
    $("#login-overlay").classList.remove("open");
    document.body.style.overflow = "";
  }
  async function fazerLogin(ev) {
    ev.preventDefault();
    const url = $("#login-url").value.trim();
    const senha = $("#login-senha").value.trim();
    if (!url || !senha) { $("#login-msg").textContent = "Preencha URL e senha."; return; }
    state.apiUrl = url;
    state.token = senha;
    try {
      await apiFetch();
      localStorage.setItem(LS_KEY_URL, url);
      localStorage.setItem(LS_KEY_TOKEN, senha);
      fecharLogin();
      carregar();
    } catch (err) {
      state.token = "";
      $("#login-msg").textContent = "❌ " + err.message;
    }
  }
  function logout() {
    localStorage.removeItem(LS_KEY_TOKEN);
    state.token = "";
    state.entradas = []; state.saidas = [];
    abrirLogin("Sessão encerrada.");
  }

  // ----------------- CARREGAR -----------------
  async function carregar() {
    $("#loader").style.display = "flex";
    try {
      const res = await apiFetch();
      state.entradas = res.entradas || [];
      state.saidas = res.saidas || [];
      localStorage.setItem(LS_KEY_CACHE, JSON.stringify({ ts: Date.now(), e: state.entradas, s: state.saidas }));
    } catch (err) {
      if (err.message.toLowerCase().includes("senha") || err.message.toLowerCase().includes("login") || err.message.toLowerCase().includes("token")) {
        abrirLogin(err.message);
        $("#loader").style.display = "none";
        return;
      }
      const cache = localStorage.getItem(LS_KEY_CACHE);
      if (cache) {
        const c = JSON.parse(cache);
        state.entradas = c.e || []; state.saidas = c.s || [];
        toast("API indisponível — usando cache.", true);
      } else {
        toast(err.message, true);
      }
    } finally {
      $("#loader").style.display = "none";
      popularAnos();
      render();
    }
  }

  function popularAnos() {
    const anos = Array.from(new Set([
      ...state.entradas.map((x) => x.ano),
      ...state.saidas.map((x) => x.ano),
    ].filter(Boolean))).sort((a, b) => b - a);
    const sel = $("#filtro-ano");
    sel.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    if (!anos.includes(state.anoSelecionado)) state.anoSelecionado = anos[0];
    sel.value = state.anoSelecionado;
  }

  // ----------------- RENDER -----------------
  function render() {
    const ano = state.anoSelecionado;
    const e = state.entradas.filter((x) => x.ano === ano);
    const s = state.saidas.filter((x) => x.ano === ano);

    // KPIs principais
    // OBS: ao agregar receitas anuais, ignoramos "Saldo Mês Anterior" (carry-over, não é receita real)
    const totReceita = e.filter((x) => x.categoria !== "Saldo Mês Anterior").reduce((s, x) => s + (x.valor || 0), 0);
    const totDespesa = s.reduce((sum, x) => sum + (x.valor || 0), 0);
    const saldo = totReceita - totDespesa;
    const margem = totReceita > 0 ? (saldo / totReceita) * 100 : 0;

    $("#stat-receita").textContent = fmtBRL(totReceita);
    $("#stat-despesa").textContent = fmtBRL(totDespesa);
    $("#stat-saldo").textContent = fmtBRL(saldo);
    $("#stat-saldo").className = "val " + (saldo >= 0 ? "pos" : "neg");
    $("#stat-margem").textContent = margem.toFixed(1) + "%";
    $("#stat-margem").className = "val " + (margem >= 0 ? "pos" : "neg");

    // Comparativo ano anterior
    const eAnt = state.entradas.filter((x) => x.ano === ano - 1 && x.categoria !== "Saldo Mês Anterior");
    const sAnt = state.saidas.filter((x) => x.ano === ano - 1);
    const totReceitaAnt = eAnt.reduce((s, x) => s + (x.valor || 0), 0);
    const totDespesaAnt = sAnt.reduce((s, x) => s + (x.valor || 0), 0);
    const saldoAnt = totReceitaAnt - totDespesaAnt;
    $("#stat-receita-sub").textContent = comparativo(totReceita, totReceitaAnt, ano - 1);
    $("#stat-despesa-sub").textContent = comparativo(totDespesa, totDespesaAnt, ano - 1);
    $("#stat-saldo-sub").textContent = comparativo(saldo, saldoAnt, ano - 1);

    // Buckets por mês
    const bucketsReceita = new Array(12).fill(0);
    const bucketsDespesa = new Array(12).fill(0);
    e.filter((x) => x.categoria !== "Saldo Mês Anterior").forEach((x) => {
      if (x.mes >= 1 && x.mes <= 12) bucketsReceita[x.mes - 1] += x.valor || 0;
    });
    s.forEach((x) => {
      if (x.mes >= 1 && x.mes <= 12) bucketsDespesa[x.mes - 1] += x.valor || 0;
    });

    renderGraficoRxD(bucketsReceita, bucketsDespesa);
    renderGraficoSaldo(bucketsReceita, bucketsDespesa);
    renderTopSaidas(s);
    renderTopEntradas(e.filter((x) => x.categoria !== "Saldo Mês Anterior"));
    renderTabelaMensal(bucketsReceita, bucketsDespesa, totReceita, totDespesa, saldo, margem);
  }

  function comparativo(v, ant, anoAnt) {
    if (!ant) return "sem dado em " + anoAnt;
    const d = ((v - ant) / Math.abs(ant)) * 100;
    const arrow = d >= 0 ? "↑" : "↓";
    return `${arrow} ${Math.abs(d).toFixed(1)}% vs ${anoAnt}`;
  }

  // ----------------- GRÁFICOS -----------------
  function destroyChart(name) {
    if (state.charts[name]) { state.charts[name].destroy(); state.charts[name] = null; }
  }

  function renderGraficoRxD(receitas, despesas) {
    const ctx = $("#chart-rxd").getContext("2d");
    destroyChart("rxd");
    state.charts.rxd = new Chart(ctx, {
      type: "bar",
      data: {
        labels: MESES_PT.map((m) => m.slice(0, 3)),
        datasets: [
          { label: "Receitas", data: receitas, backgroundColor: "rgba(46, 125, 79, 0.85)", borderColor: "#2e7d4f", borderWidth: 1, borderRadius: 4 },
          { label: "Despesas", data: despesas, backgroundColor: "rgba(139, 58, 58, 0.85)", borderColor: "#8b3a3a", borderWidth: 1, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: "#5a6573", font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ": " + fmtBRL(ctx.parsed.y) } },
        },
        scales: {
          y: { ticks: { callback: (v) => "R$ " + fmtBRLk(v), font: { size: 10 }, color: "#5a6573" }, grid: { color: "#f0eee9" } },
          x: { ticks: { font: { size: 11 }, color: "#5a6573" }, grid: { display: false } },
        },
      },
    });
  }

  function renderGraficoSaldo(receitas, despesas) {
    const acumulado = [];
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += receitas[i] - despesas[i];
      acumulado.push(sum);
    }
    const ctx = $("#chart-saldo").getContext("2d");
    destroyChart("saldo");
    state.charts.saldo = new Chart(ctx, {
      type: "line",
      data: {
        labels: MESES_PT.map((m) => m.slice(0, 3)),
        datasets: [{
          label: "Saldo acumulado",
          data: acumulado,
          borderColor: "#c9a961",
          backgroundColor: "rgba(201, 169, 97, 0.15)",
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: "#0a2540",
          pointBorderColor: "#c9a961",
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => "Saldo acumulado: " + fmtBRL(ctx.parsed.y) } },
        },
        scales: {
          y: { ticks: { callback: (v) => "R$ " + fmtBRLk(v), font: { size: 10 }, color: "#5a6573" }, grid: { color: "#f0eee9" } },
          x: { ticks: { font: { size: 11 }, color: "#5a6573" }, grid: { display: false } },
        },
      },
    });
  }

  function renderTopSaidas(saidas) {
    const buckets = {};
    saidas.forEach((x) => { buckets[x.categoria] = (buckets[x.categoria] || 0) + (x.valor || 0); });
    const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map((x) => x[0]);
    const values = sorted.map((x) => x[1]);

    const ctx = $("#chart-top-saidas").getContext("2d");
    destroyChart("top-saidas");
    state.charts["top-saidas"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: "rgba(139, 58, 58, 0.8)",
          borderColor: "#8b3a3a",
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmtBRL(ctx.parsed.x) } },
        },
        scales: {
          x: { ticks: { callback: (v) => "R$ " + fmtBRLk(v), font: { size: 10 }, color: "#5a6573" }, grid: { color: "#f0eee9" } },
          y: { ticks: { font: { size: 11 }, color: "#5a6573" }, grid: { display: false } },
        },
      },
    });
  }

  function renderTopEntradas(entradas) {
    const buckets = {};
    entradas.forEach((x) => { buckets[x.categoria] = (buckets[x.categoria] || 0) + (x.valor || 0); });
    const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map((x) => x[0]);
    const values = sorted.map((x) => x[1]);

    const ctx = $("#chart-top-entradas").getContext("2d");
    destroyChart("top-entradas");
    state.charts["top-entradas"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: "rgba(46, 125, 79, 0.8)",
          borderColor: "#2e7d4f",
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => fmtBRL(ctx.parsed.x) } },
        },
        scales: {
          x: { ticks: { callback: (v) => "R$ " + fmtBRLk(v), font: { size: 10 }, color: "#5a6573" }, grid: { color: "#f0eee9" } },
          y: { ticks: { font: { size: 11 }, color: "#5a6573" }, grid: { display: false } },
        },
      },
    });
  }

  function renderTabelaMensal(receitas, despesas, totRec, totDes, totSal, totMar) {
    const tbody = $("#tabela-mensal");
    tbody.innerHTML = receitas.map((r, i) => {
      const d = despesas[i];
      const sal = r - d;
      const mar = r > 0 ? (sal / r * 100) : 0;
      return `<tr>
        <td style="font-weight:500">${MESES_PT[i]}</td>
        <td class="col-valor" style="color:var(--pos)">${fmtBRL(r)}</td>
        <td class="col-valor" style="color:var(--neg)">${fmtBRL(d)}</td>
        <td class="col-valor" style="color:${sal >= 0 ? 'var(--pos)' : 'var(--neg)'}">${fmtBRL(sal)}</td>
        <td class="col-valor" style="font-family: var(--font-sans); font-size: 13px; color:${mar >= 0 ? 'var(--pos)' : 'var(--neg)'}">${mar.toFixed(1)}%</td>
      </tr>`;
    }).join("");
    $("#tot-rec").textContent = fmtBRL(totRec);
    $("#tot-des").textContent = fmtBRL(totDes);
    $("#tot-sal").textContent = fmtBRL(totSal);
    $("#tot-sal").style.color = totSal >= 0 ? "var(--pos)" : "var(--neg)";
    $("#tot-mar").textContent = totMar.toFixed(1) + "%";
    $("#tot-mar").style.color = totMar >= 0 ? "var(--pos)" : "var(--neg)";
    $("#tot-mar").style.fontFamily = "var(--font-sans)";
    $("#tot-mar").style.fontSize = "14px";
  }

  // ----------------- TROCAR SENHA -----------------
  function abrirTrocarSenha() {
    $("#trocar-form").reset();
    $("#trocar-msg").textContent = "";
    $("#trocar-msg").className = "trocar-msg";
    $("#trocar-modal").classList.add("open");
  }
  function fecharTrocarSenha() { $("#trocar-modal").classList.remove("open"); }

  async function salvarNovaSenha(ev) {
    ev.preventDefault();
    const atual = $("#trocar-atual").value.trim();
    const nova = $("#trocar-nova").value.trim();
    const conf = $("#trocar-confirma").value.trim();
    const msg = $("#trocar-msg");
    msg.className = "trocar-msg";

    if (atual !== state.token) {
      msg.textContent = "Senha atual incorreta.";
      msg.classList.add("err"); return;
    }
    if (nova.length < 6) {
      msg.textContent = "Nova senha precisa ter ao menos 6 caracteres.";
      msg.classList.add("err"); return;
    }
    if (nova !== conf) {
      msg.textContent = "A confirmação não bate com a nova senha.";
      msg.classList.add("err"); return;
    }
    if (nova === atual) {
      msg.textContent = "A nova senha precisa ser diferente da atual.";
      msg.classList.add("err"); return;
    }
    msg.textContent = "Enviando…";
    try {
      const r = await fetch(state.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ acao: "trocar-senha", token: state.token, novaSenha: nova }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.erro);
      state.token = nova;
      localStorage.setItem(LS_KEY_TOKEN, nova);
      msg.textContent = "✓ Senha alterada. Notificação enviada por email.";
      msg.classList.add("ok");
      setTimeout(() => { fecharTrocarSenha(); toast("Senha alterada com sucesso."); }, 1400);
    } catch (err) {
      msg.textContent = "Erro: " + err.message;
      msg.classList.add("err");
    }
  }

  // ----------------- INIT -----------------
  document.addEventListener("DOMContentLoaded", () => {
    $("#filtro-ano").addEventListener("change", (e) => {
      state.anoSelecionado = parseInt(e.target.value, 10);
      render();
    });
    $("#btn-recarregar").addEventListener("click", carregar);
    $("#btn-logout").addEventListener("click", logout);
    $("#login-form").addEventListener("submit", fazerLogin);

    // Trocar senha
    $("#btn-trocar-senha").addEventListener("click", abrirTrocarSenha);
    $("#btn-fechar-trocar").addEventListener("click", fecharTrocarSenha);
    $("#btn-cancelar-trocar").addEventListener("click", fecharTrocarSenha);
    $("#trocar-form").addEventListener("submit", salvarNovaSenha);
    $("#trocar-modal").addEventListener("click", (e) => {
      if (e.target.id === "trocar-modal") fecharTrocarSenha();
    });

    if (!state.apiUrl || !state.token) {
      abrirLogin("Configure a URL e digite sua senha.");
      return;
    }
    carregar();
  });
})();
