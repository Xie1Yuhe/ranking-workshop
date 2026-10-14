/* ==========================================================================
   从夯到拉 · 排名工坊（桌面版）
   原生 JavaScript，无框架依赖。
   ========================================================================== */

(function () {
    'use strict';

    /* ---------------------------------------------------------------- */
    /* 常量                                                              */
    /* ---------------------------------------------------------------- */

    var STORAGE_KEY = 'ranking-workshop-state-v3';

    /* 赛道配色板：取自参考图里从上到下的 9 条色带
       红 → 橙 → 黄 → 淡黄 → 黄绿 → 绿 → 青 → 蓝 → 淡蓝
       默认用掉前 8 种，新增赛道往后取，用完则循环。 */
    var TIER_PALETTE = [
        { start: '#f87e7d' },
        { start: '#f8bf7c' },
        { start: '#fcdf7b' },
        { start: '#fdfd79' },
        { start: '#c5fc7a' },
        { start: '#8efc7f' },
        { start: '#8efeff' },
        { start: '#88bfff' },
        { start: '#b8d4ff' }
    ];

    var DEFAULT_TIERS = [
        { key: 't0', label: '超大杯上', description: '不可名状之神，独断万古，比肩原作者' },
        { key: 't1', label: '超大杯中', description: '人类可理解范围之内的绝对强者' },
        { key: 't2', label: '超大杯下', description: '稳定站在顶端，几乎没有短板' },
        { key: 't3', label: '大杯上', description: '表现优秀，值得优先推荐' },
        { key: 't4', label: '大杯中', description: '中规中矩，适合放在中段' },
        { key: 't5', label: '大杯下', description: '表现偏弱，需要靠后排布' },
        { key: 't6', label: '中杯', description: '删了没人知道' },
        { key: 't7', label: '小杯', description: '由于倒霉被人反复点名批评' }
    ];

    var DEFAULT_SETTINGS = {
        theme: 'black-gold',
        tierStyle: 'card',
        compact: false,
        showNames: true,
        showNotes: false,
        sort: 'manual',
        search: '',
        tierFilter: 'all',
        noteFilter: 'all',
        exportOptions: { showTitle: true, showPool: false, showSummary: false }
    };

    /* ---------------------------------------------------------------- */
    /* 运行状态                                                          */
    /* ---------------------------------------------------------------- */

    var state = null;
    var tiers = [];
    var settings = {};
    var saveTimer = null;
    var lastSaveAt = 0;
    var currentItemId = null;
    var currentTierKey = null;
    var currentTierColor = '';
    var presentationItemId = null;
    var presentationLastHandledName = '';
    var dragDepth = 0;

    var els = {};

    /* ---------------------------------------------------------------- */
    /* 小工具                                                            */
    /* ---------------------------------------------------------------- */

    function $(id) { return document.getElementById(id); }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function uid() {
        return 'item-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    function formatTime(ts) {
        var value = Number(ts);
        if (!value) return '未知时间';
        var d = new Date(value);
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function toast(message) {
        var node = el('div', 'toast', message);
        els.toasts.appendChild(node);
        window.setTimeout(function () {
            node.style.transition = 'opacity .25s ease, transform .25s ease';
            node.style.opacity = '0';
            node.style.transform = 'translateY(8px)';
            window.setTimeout(function () { node.remove(); }, 260);
        }, 2100);
    }

    function debounce(fn, ms) {
        var timer = null;
        return function () {
            var args = arguments;
            var self = this;
            window.clearTimeout(timer);
            timer = window.setTimeout(function () { fn.apply(self, args); }, ms);
        };
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function (event) { resolve(event.target.result); };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function isHex(value) {
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    }

    function mixHex(hex, target, ratio) {
        var source = hex.replace('#', '');
        var r = parseInt(source.slice(0, 2), 16);
        var g = parseInt(source.slice(2, 4), 16);
        var b = parseInt(source.slice(4, 6), 16);
        var mix = function (base) {
            return Math.round(base + (target - base) * ratio);
        };
        var toHex = function (value) {
            return value.toString(16).padStart(2, '0');
        };
        return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
    }

    /* 半透明版本，用于落点发光的底色（不依赖 color-mix，兼容性更好） */
    function hexToRgba(hex, alpha) {
        var source = hex.replace('#', '');
        var r = parseInt(source.slice(0, 2), 16);
        var g = parseInt(source.slice(2, 4), 16);
        var b = parseInt(source.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    }

    /* 赛道颜色：抬头用同色系的浅→深渐变；minimal / neon 风格用加深后的纯色文字 */
    function tierColors(tier) {
        var index = tiers.indexOf(tier);
        var base = isHex(tier.color)
            ? tier.color
            : paletteForIndex(index < 0 ? 0 : index).start;
        return {
            start: base,
            end: mixHex(base, 0, 0.42),
            ink: mixHex(base, 0, 0.5)
        };
    }

    function paletteForIndex(index) {
        return TIER_PALETTE[index % TIER_PALETTE.length];
    }

    /* 新赛道取一个还没被用掉的配色，避免和现有赛道撞色 */
    function nextTierColor() {
        var used = tiers.map(function (tier) {
            return tierColors(tier).start.toLowerCase();
        });
        for (var i = 0; i < TIER_PALETTE.length; i += 1) {
            if (used.indexOf(TIER_PALETTE[i].start.toLowerCase()) < 0) return TIER_PALETTE[i].start;
        }
        return TIER_PALETTE[tiers.length % TIER_PALETTE.length].start;
    }

    function tierColor(tier) {
        return tierColors(tier).start;
    }

    function findTier(key) {
        return tiers.filter(function (entry) { return entry.key === key; })[0] || null;
    }

    function createTier(label, description) {
        var index = tiers.length;
        var preset = TIER_PALETTE[index % TIER_PALETTE.length];
        return {
            key: 'tier-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            label: label || ('第 ' + (index + 1) + ' 档'),
            description: description || '双击这里可以修改说明',
            color: preset.start
        };
    }

    /* ---------------------------------------------------------------- */
    /* 数据                                                              */
    /* ---------------------------------------------------------------- */

    function buildTierState(rawTiers) {
        var source = (Array.isArray(rawTiers) ? rawTiers : []).filter(function (item) {
            return item && item.key && item.key !== 'pool';
        });

        var defaults = DEFAULT_TIERS.map(function (base, index) {
            var matched = source.filter(function (item) { return item.key === base.key; })[0];
            return {
                key: base.key,
                label: (matched && String(matched.label || '').trim()) || base.label,
                description: (matched && String(matched.description || '').trim()) || base.description,
                color: (matched && isHex(matched.color)) ? matched.color : paletteForIndex(index).start
            };
        });

        /* 用户自己加的赛道按原顺序保留在后面 */
        var defaultKeys = DEFAULT_TIERS.map(function (base) { return base.key; });
        var extras = source.filter(function (item) {
            return defaultKeys.indexOf(item.key) < 0;
        }).map(function (item, index) {
            var fallback = paletteForIndex(defaults.length + index);
            return {
                key: item.key,
                label: String(item.label || '').trim() || ('第 ' + (defaults.length + index + 1) + ' 档'),
                description: String(item.description || '').trim(),
                color: isHex(item.color) ? item.color : fallback.start
            };
        });

        return defaults.concat(extras);
    }

    function normalizeImages(rawImages) {
        return (Array.isArray(rawImages) ? rawImages : []).map(function (item) {
            var name = String((item && item.name) || '').trim() || '未命名';
            return {
                id: (item && item.id) || uid(),
                src: (item && item.src) || '',
                kind: (item && item.kind) === 'text' ? 'text' : 'image',
                name: name,
                note: (item && item.note) || '',
                createdAt: Number(item && item.createdAt) || Date.now(),
                tier: (item && item.tier) || 'pool',
                order: Number(item && item.order) || 0
            };
        });
    }

    function createState(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        return {
            version: 3,
            boardTitle: String(source.boardTitle || '').trim() || '从夯到拉 · 排名工坊',
            settings: Object.assign({}, DEFAULT_SETTINGS, source.settings || {}, {
                exportOptions: Object.assign({}, DEFAULT_SETTINGS.exportOptions, (source.settings && source.settings.exportOptions) || {})
            }),
            tiers: buildTierState(source.tiers),
            images: normalizeImages(source.images)
        };
    }

    function getItem(id) {
        return state.images.filter(function (item) { return item.id === id; })[0] || null;
    }

    function itemsOf(tierKey) {
        return state.images
            .filter(function (item) { return item.tier === tierKey; })
            .sort(function (a, b) { return a.order - b.order; });
    }

    /* ---------------------------------------------------------------- */
    /* 保存                                                              */
    /* ---------------------------------------------------------------- */

    function setSaveState(kind, text) {
        els.saveState.dataset.state = kind;
        els.saveStateText.textContent = text;
    }

    function saveNow() {
        if (!state) return Promise.resolve(false);
        syncFromDom();
        var payload = JSON.parse(JSON.stringify(state));
        setSaveState('saving', '正在保存…');
        return fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            lastSaveAt = Date.now();
            setSaveState('saved', '已保存 · ' + formatTime(lastSaveAt));
            return true;
        }).catch(function (error) {
            setSaveState('error', '保存失败：' + error.message);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) { /* 忽略 */ }
            return false;
        });
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveNow, 400);
    }

    function syncFromDom() {
        state.boardTitle = (els.boardTitleInput.value || '').trim() || '从夯到拉 · 排名工坊';
        state.settings = Object.assign({}, settings, {
            compact: els.compactToggle.checked,
            showNames: els.nameToggle.checked,
            showNotes: els.noteToggle.checked,
            sort: els.sortSelect.value,
            search: els.searchInput.value,
            tierFilter: els.tierFilter.value,
            noteFilter: els.noteFilter.value
        });
    }

    /* ---------------------------------------------------------------- */
    /* 榜单渲染                                                          */
    /* ---------------------------------------------------------------- */

    function paintTierLabel(label, tier) {
        var colors = tierColors(tier);
        label.style.setProperty('--tier-a', colors.start);
        label.style.setProperty('--tier-b', colors.end);
        label.style.setProperty('--tier-ink', colors.ink);
        label.style.background = 'linear-gradient(160deg, ' + colors.start + ', ' + colors.end + ')';
    }

    function buildTierRow(tier) {
        var row = el('div', 'tier-row');
        row.dataset.tier = tier.key;

        var label = el('div', 'tier-label');
        paintTierLabel(label, tier);

        var name = el('div', 'tier-label__name', tier.label);
        name.title = '双击修改赛道名称';
        name.addEventListener('dblclick', function () { editTier(tier.key, 'label'); });

        var desc = el('div', 'tier-label__desc', tier.description);
        desc.title = '双击修改赛道说明';
        desc.addEventListener('dblclick', function () { editTier(tier.key, 'description'); });

        var count = el('span', 'tier-label__count', '0');

        var tools = el('div', 'tier-label__tools');
        var colorBtn = el('button', 'tier-label__tool', '🎨');
        colorBtn.type = 'button';
        colorBtn.title = '修改赛道颜色';
        colorBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            openTierModal(tier.key);
        });
        var delBtn = el('button', 'tier-label__tool', '✕');
        delBtn.type = 'button';
        delBtn.title = '删除这个赛道';
        delBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            removeTier(tier.key);
        });
        tools.appendChild(colorBtn);
        tools.appendChild(delBtn);

        label.appendChild(tools);
        label.appendChild(name);
        label.appendChild(desc);
        label.appendChild(count);

        var drop = el('div', 'tier-drop');
        drop.dataset.tier = tier.key;
        drop.dataset.zone = 'tier';
        var dropColors = tierColors(tier);
        drop.style.setProperty('--tier-color', dropColors.start);
        drop.style.setProperty('--tier-ink', dropColors.ink);
        drop.style.setProperty('--tier-tint', hexToRgba(dropColors.start, 0.24));
        setupDropZone(drop);

        row.appendChild(label);
        row.appendChild(drop);
        return row;
    }

    /* 榜单下方的「加号」：再增加一个赛道 */
    function buildAddTierRow() {
        var row = el('div', 'add-tier-row');
        var btn = el('button', 'add-tier-btn');
        btn.type = 'button';
        btn.title = '在榜单最下方增加一个赛道';
        btn.innerHTML = '<span class="add-tier-btn__icon">＋</span><span>增加一个赛道</span>';
        btn.addEventListener('click', addTier);
        row.appendChild(btn);
        return row;
    }

    function renderBoard() {
        els.tierContainer.innerHTML = '';
        tiers.forEach(function (tier) {
            els.tierContainer.appendChild(buildTierRow(tier));
        });
        els.tierContainer.appendChild(buildAddTierRow());
        renderItems();
    }

    function renderItems() {
        document.querySelectorAll('.tier-drop').forEach(function (zone) {
            Array.prototype.slice.call(zone.querySelectorAll('.item, .drop-hint')).forEach(function (node) { node.remove(); });
        });

        tiers.forEach(function (tier) {
            var zone = document.querySelector('.tier-drop[data-tier="' + tier.key + '"]');
            if (!zone) return;
            var list = itemsOf(tier.key);
            if (!list.length) {
                zone.appendChild(el('span', 'drop-hint', '把内容拖到这里'));
            } else {
                list.forEach(function (item) { zone.appendChild(buildItemNode(item)); });
            }
            var row = zone.closest('.tier-row');
            var badge = row ? row.querySelector('.tier-label__count') : null;
            if (badge) badge.textContent = String(list.length);
        });

        els.poolGrid.innerHTML = '';
        var pool = itemsOf('pool');
        if (!pool.length) {
            var empty = el('div', 'pool-empty');
            empty.innerHTML = '<strong>内容池是空的</strong><span>上传图片、粘贴截图或添加文字项<br>然后把卡片拖到右侧赛道</span>';
            els.poolGrid.appendChild(empty);
        } else {
            pool.forEach(function (item) { els.poolGrid.appendChild(buildItemNode(item)); });
        }

        renderTierList();
        updateStats();
        renderSummary();
        applyFilters();
    }

    function buildItemNode(item) {
        var node = el('div', 'item');
        node.dataset.id = item.id;
        node.draggable = true;
        node.title = item.note ? item.name + '：' + item.note : item.name;

        var itemTier = findTier(item.tier);
        if (itemTier) {
            var itemColors = tierColors(itemTier);
            node.style.setProperty('--tier-color', itemColors.start);
            node.style.setProperty('--tier-ink', itemColors.ink);
        }

        var media = el('div', 'item__media');
        if (item.kind === 'text' || !item.src) {
            media.appendChild(el('div', 'item__text', item.name));
        } else {
            var img = el('img');
            img.src = item.src;
            img.alt = item.name;
            img.draggable = false;
            media.appendChild(img);
        }

        var tier = tiers.filter(function (entry) { return entry.key === item.tier; })[0];
        media.appendChild(el('span', 'item__tag', tier ? tier.label : '内容池'));
        node.appendChild(media);

        var actions = el('div', 'item__actions');
        var back = el('button', 'item__btn', '↩');
        back.type = 'button';
        back.title = '退回内容池';
        back.addEventListener('click', function (event) {
            event.stopPropagation();
            moveItem(item.id, 'pool');
            toast('已退回内容池');
        });
        var del = el('button', 'item__btn', '✕');
        del.type = 'button';
        del.title = '删除';
        del.addEventListener('click', function (event) {
            event.stopPropagation();
            deleteItem(item.id);
        });
        actions.appendChild(back);
        actions.appendChild(del);
        node.appendChild(actions);

        node.appendChild(el('div', 'item__name', item.name));
        if (item.note) {
            node.appendChild(el('div', 'item__note', item.note));
            node.classList.add('has-note');
        } else {
            node.classList.add('no-note');
        }

        node.addEventListener('click', function () { openItemModal(item.id); });
        node.addEventListener('dragstart', function (event) {
            event.dataTransfer.setData('text/plain', item.id);
            event.dataTransfer.effectAllowed = 'move';
            node.classList.add('is-dragging');
        });
        node.addEventListener('dragend', function () {
            node.classList.remove('is-dragging');
            document.querySelectorAll('.drag-over').forEach(function (zone) { zone.classList.remove('drag-over'); });
        });
        return node;
    }

    function renderTierList() {
        els.tierList.innerHTML = '';
        tiers.forEach(function (tier) {
            var list = itemsOf(tier.key);
            var node = el('div', 'tier-line');
            node.style.setProperty('--tier-color', tierColors(tier).start);

            var info = el('div');
            info.appendChild(el('span', 'tier-line__name', tier.label));
            info.appendChild(el('span', 'tier-line__sub', list.length ? list.slice(0, 4).map(function (i) { return i.name; }).join('、') + (list.length > 4 ? ' …' : '') : tier.description));

            var bar = el('span', 'tier-line__bar');
            bar.style.background = tierColors(tier).start;
            node.appendChild(bar);
            node.appendChild(info);
            node.appendChild(el('span', 'tier-line__count', String(list.length)));
            node.addEventListener('click', function () {
                var row = document.querySelector('.tier-row[data-tier="' + tier.key + '"]');
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            els.tierList.appendChild(node);
        });
    }

    function updateStats() {
        var total = state.images.length;
        var ranked = state.images.filter(function (item) { return item.tier !== 'pool'; }).length;
        var pending = total - ranked;
        var rate = total ? Math.round((ranked / total) * 100) : 0;
        var notes = state.images.filter(function (item) { return (item.note || '').trim(); }).length;

        els.statTotal.textContent = String(total);
        els.statRanked.textContent = String(ranked);
        els.statPending.textContent = String(pending);
        els.statRate.innerHTML = rate + '<small>%</small>';
        els.statRatio.textContent = notes ? notes + ' 条点评' : '暂无点评';
        els.poolCountLabel.textContent = pending + ' 项';
    }

    /* ---------------------------------------------------------------- */
    /* 赛道说明编辑                                                      */
    /* ---------------------------------------------------------------- */

    function editTier(key, field) {
        var tier = tiers.filter(function (entry) { return entry.key === key; })[0];
        if (!tier) return;
        var next = window.prompt(field === 'label' ? '修改赛道名称：' : '修改赛道说明：', tier[field]);
        if (next === null) return;
        tier[field] = next.trim() || tier[field];
        renderBoard();
        scheduleSave();
        toast('赛道已更新');
    }

    /* ---------------------------------------------------------------- */
    /* 增加 / 删除赛道                                                   */
    /* ---------------------------------------------------------------- */

    function addTier() {
        var tier = createTier('第 ' + (tiers.length + 1) + ' 档', '双击这里可以修改说明');
        tier.color = nextTierColor();
        tiers.push(tier);

        renderBoard();
        fillControls();
        restartTierAnimation(els.tierContainer.querySelector('.tier-row[data-tier="' + tier.key + '"]'));
        var row = els.tierContainer.querySelector('.tier-row[data-tier="' + tier.key + '"]');
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scheduleSave();
        toast('已增加一个赛道，点 🎨 可以改颜色和名称');
    }

    function restartTierAnimation(row) {
        if (!row) return;
        row.classList.add('tier-row--new');
        window.setTimeout(function () { row.classList.remove('tier-row--new'); }, 700);
    }

    function removeTier(key) {
        if (tiers.length <= 1) {
            toast('至少要保留一个赛道');
            return;
        }
        var tier = findTier(key);
        if (!tier) return;

        var list = itemsOf(key);
        var message = '确定删除赛道「' + tier.label + '」吗？'
            + (list.length ? '\n其中的 ' + list.length + ' 项内容会退回内容池。' : '');
        if (!window.confirm(message)) return;

        var poolOrder = itemsOf('pool').length;
        list.forEach(function (item, index) {
            item.tier = 'pool';
            item.order = poolOrder + index;
        });

        tiers = tiers.filter(function (entry) { return entry.key !== key; });
        state.tiers = tiers;
        renderBoard();
        fillControls();
        scheduleSave();
        toast('已删除赛道「' + tier.label + '」');
    }

    /* ---------------------------------------------------------------- */
    /* 赛道编辑弹窗                                                      */
    /* ---------------------------------------------------------------- */

    function openTierModal(key) {
        var tier = findTier(key);
        if (!tier) return;
        currentTierKey = key;
        els.tierModal.classList.add('is-open');
        fillTierModal(tier);
    }

    function fillTierModal(tier) {
        els.tierModalTitle.textContent = '编辑赛道';
        els.tierLabelInput.value = tier.label;
        els.tierDescInput.value = tier.description;
        currentTierColor = tierColors(tier).start;

        els.tierSwatches.innerHTML = '';
        TIER_PALETTE.forEach(function (preset, index) {
            var swatch = el('button', 'swatch');
            swatch.type = 'button';
            swatch.title = '配色 ' + (index + 1);
            swatch.style.background = 'linear-gradient(140deg, ' + preset.start + ', ' + mixHex(preset.start, 0, 0.42) + ')';
            if (preset.start.toLowerCase() === currentTierColor.toLowerCase()) {
                swatch.classList.add('is-active');
            }
            swatch.addEventListener('click', function () {
                currentTierColor = preset.start;
                Array.prototype.slice.call(els.tierSwatches.querySelectorAll('.swatch')).forEach(function (node) {
                    node.classList.remove('is-active');
                });
                swatch.classList.add('is-active');
                saveTierModal();
            });
            els.tierSwatches.appendChild(swatch);
        });
    }

    function saveTierModal() {
        var tier = findTier(currentTierKey);
        if (!tier) return;
        tier.label = (els.tierLabelInput.value || '').trim() || tier.label;
        tier.description = (els.tierDescInput.value || '').trim();
        if (isHex(currentTierColor)) tier.color = currentTierColor;

        var row = els.tierContainer.querySelector('.tier-row[data-tier="' + tier.key + '"]');
        if (row) {
            paintTierLabel(row.querySelector('.tier-label'), tier);
            row.querySelector('.tier-label__name').textContent = tier.label;
            row.querySelector('.tier-label__desc').textContent = tier.description;
            Array.prototype.slice.call(row.querySelectorAll('.item__tag')).forEach(function (tag) {
                tag.textContent = tier.label;
            });
        }
        fillControls();
        renderTierList();
        renderSummary();
        applyFilters();
        scheduleSave();
    }

    /* ---------------------------------------------------------------- */
    /* 内容池批量操作                                                    */
    /* ---------------------------------------------------------------- */

    function resetRanked() {
        var ranked = state.images.filter(function (item) { return item.tier !== 'pool'; });
        if (!ranked.length) {
            toast('当前没有已排名内容');
            return;
        }
        if (!window.confirm('确定把已排名的 ' + ranked.length + ' 项全部打回内容池吗？\n（内容不会删除，只是清空赛道）')) {
            return;
        }
        var base = itemsOf('pool').length;
        ranked.forEach(function (item, index) {
            item.tier = 'pool';
            item.order = base + index;
        });
        renderItems();
        scheduleSave();
        toast('已把 ' + ranked.length + ' 项打回内容池');
    }

    function clearPool() {
        var pool = itemsOf('pool');
        if (!pool.length) {
            toast('内容池已经是空的');
            return;
        }
        if (!window.confirm('确定一键删除内容池里的 ' + pool.length + ' 项内容吗？此操作不可撤销。\n（已经排进赛道的内容不受影响）')) {
            return;
        }
        var ids = pool.map(function (item) { return item.id; });
        state.images = state.images.filter(function (item) { return ids.indexOf(item.id) < 0; });
        if (currentItemId && ids.indexOf(currentItemId) >= 0) closeItemModal();
        renderItems();
        scheduleSave();
        toast('已清空内容池，共删除 ' + ids.length + ' 项');
    }

    function editBoardTitle() {
        var next = window.prompt('修改榜单标题：', state.boardTitle);
        if (next === null) return;
        state.boardTitle = next.trim() || state.boardTitle;
        els.boardTitleInput.value = state.boardTitle;
        els.boardTitleDisplay.textContent = state.boardTitle;
        document.title = state.boardTitle;
        scheduleSave();
    }

    /* ---------------------------------------------------------------- */
    /* 拖拽                                                              */
    /* ---------------------------------------------------------------- */

    function setupDropZone(zone) {
        zone.addEventListener('dragover', function (event) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', function () {
            zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', function (event) {
            event.preventDefault();
            zone.classList.remove('drag-over');
            var id = event.dataTransfer.getData('text/plain');
            if (!id || !getItem(id)) return;
            moveItem(id, zone.dataset.tier, findReference(zone, event, id), { banner: true });
        });
    }

    function findReference(zone, event, movingId) {
        var nodes = Array.prototype.slice.call(zone.querySelectorAll('.item')).filter(function (node) {
            return node.dataset.id !== movingId;
        });
        if (!nodes.length) return null;
        var target = null;
        for (var i = 0; i < nodes.length; i += 1) {
            var rect = nodes[i].getBoundingClientRect();
            if (event.clientY < rect.bottom && event.clientX < rect.right) {
                target = nodes[i];
                break;
            }
        }
        if (!target) {
            return { afterId: nodes[nodes.length - 1].dataset.id };
        }
        var box = target.getBoundingClientRect();
        return event.clientX > box.left + box.width / 2
            ? { afterId: target.dataset.id }
            : { beforeId: target.dataset.id };
    }

    /* ---------------------------------------------------------------- */
    /* 入榜动效：落点发光 + 卡片弹跳 + 赛道横幅                        */
    /* ---------------------------------------------------------------- */

    function playPlacementEffect(zone, id, tier, opts) {
        var options = opts || {};

        /* 赛道落点发光 */
        if (zone) {
            zone.classList.remove('receive-flash');
            void zone.offsetWidth;
            zone.classList.add('receive-flash');
            window.setTimeout(function () { zone.classList.remove('receive-flash'); }, 720);
        }

        /* 卡片弹跳 + 扩散光环 */
        var node = id ? document.querySelector('.item[data-id="' + id + '"]') : null;
        if (node) {
            node.classList.remove('just-landed');
            void node.offsetWidth;
            node.classList.add('just-landed');
            window.setTimeout(function () { node.classList.remove('just-landed'); }, 620);
        }

        if (options.banner !== false && tier) {
            showPlacementBanner(tier, options.delay || 0);
        }
    }

    function showPlacementBanner(tier, delay) {
        var colors = tierColors(tier);
        window.setTimeout(function () {
            var old = document.querySelector('.placement-banner');
            if (old) old.remove();

            var banner = el('div', 'placement-banner');
            banner.id = 'placementBanner';
            banner.style.setProperty('--tier-a', colors.start);
            banner.style.setProperty('--tier-b', colors.end);
            banner.style.setProperty('--tier-ink', colors.ink);
            banner.appendChild(el('span', 'placement-banner__tag', '已入榜'));
            banner.appendChild(el('strong', 'placement-banner__name', tier.label));
            document.body.appendChild(banner);

            window.setTimeout(function () { banner.classList.add('is-out'); }, 900);
            window.setTimeout(function () { banner.remove(); }, 1250);
        }, delay);
    }

    /* ---------------------------------------------------------------- */
    /* 拖拽                                                              */
    /* ---------------------------------------------------------------- */

    function moveItem(id, tierKey, reference, opts) {
        var item = getItem(id);
        if (!item) return;
        var options = opts || {};

        var list = state.images
            .filter(function (entry) { return entry.tier === tierKey && entry.id !== id; })
            .sort(function (a, b) { return a.order - b.order; });

        var at = list.length;
        if (reference && reference.beforeId) {
            var before = list.findIndex(function (entry) { return entry.id === reference.beforeId; });
            at = before < 0 ? list.length : before;
        } else if (reference && reference.afterId) {
            var after = list.findIndex(function (entry) { return entry.id === reference.afterId; });
            at = after < 0 ? list.length : after + 1;
        }

        var moved = item.tier !== tierKey;
        list.splice(at, 0, item);
        item.tier = tierKey;
        list.forEach(function (entry, index) { entry.order = index; });

        /* 演示模式下把「当前召唤出来的一张」标记为已处理 */
        if (moved && tierKey !== 'pool' && presentationItemId === id) {
            presentationLastHandledName = (item.name || '').trim() || '未命名';
            presentationItemId = null;
        }

        /* 记录滚动位置，重建卡片后还原，避免入榜时榜单跳动 */
        var scroller = els.tierContainer.parentElement;
        var scrollTop = scroller ? scroller.scrollTop : 0;

        renderItems();
        if (scroller) scroller.scrollTop = scrollTop;

        if (moved && tierKey !== 'pool') {
            playPlacementEffect(
                document.querySelector('.tier-drop[data-tier="' + tierKey + '"]'),
                id,
                findTier(tierKey),
                {
                    banner: options.banner !== false,
                    delay: options.delay || 0
                }
            );
        }
        updatePresentationStage();
        scheduleSave();
    }

    function deleteItem(id) {
        var item = getItem(id);
        if (!item) return;
        if (!window.confirm('确定删除「' + item.name + '」吗？')) return;
        state.images = state.images.filter(function (entry) { return entry.id !== id; });
        if (currentItemId === id) closeItemModal();
        renderItems();
        scheduleSave();
        toast('已删除「' + item.name + '」');
    }

    /* ---------------------------------------------------------------- */
    /* 内容详情                                                          */
    /* ---------------------------------------------------------------- */

    function openItemModal(id) {
        var item = getItem(id);
        if (!item) return;
        currentItemId = id;
        els.itemModal.classList.add('is-open');
        fillItemModal(item);
    }

    function fillItemModal(item) {
        var tier = tiers.filter(function (entry) { return entry.key === item.tier; })[0];
        els.itemModalTitle.textContent = item.name;
        els.itemName.value = item.name;
        els.itemNote.value = item.note || '';

        els.itemPreview.innerHTML = '';
        if (item.kind === 'text' || !item.src) {
            els.itemPreview.appendChild(el('div', 'modal__text', item.name));
        } else {
            var img = el('img');
            img.src = item.src;
            img.alt = item.name;
            els.itemPreview.appendChild(img);
        }

        els.itemMeta.innerHTML = ''
            + '类型：<strong>' + (item.kind === 'text' ? '文字项' : '图片项') + '</strong><br>'
            + '当前位置：<strong>' + (tier ? tier.label : '内容池') + '</strong><br>'
            + '加入时间：' + formatTime(item.createdAt) + '<br>'
            + '点评：' + ((item.note || '').trim() ? '已填写' : '未填写');

        els.tierButtons.innerHTML = '';
        tiers.forEach(function (entry) {
            var colors = tierColors(entry);
            var btn = el('button', 'tier-btn', '放入 ' + entry.label);
            btn.type = 'button';
            btn.style.setProperty('--tier-a', colors.start);
            btn.style.setProperty('--tier-b', colors.end);
            if (entry.key === item.tier) btn.style.outline = '2px solid var(--accent)';
            btn.addEventListener('click', function () {
                var targetId = currentItemId;
                commitItemFields();
                closeItemModal();
                /* 弹窗关闭后再落位，让落点发光和横幅能被看见 */
                moveItem(targetId, entry.key, null, { banner: true, delay: 140 });
            });
            els.tierButtons.appendChild(btn);
        });

        var poolBtn = el('button', 'tier-btn', '留在内容池');
        poolBtn.type = 'button';
        poolBtn.style.setProperty('--tier-a', '#4c5566');
        poolBtn.style.setProperty('--tier-b', '#2b3340');
        if (item.tier === 'pool') poolBtn.style.outline = '2px solid var(--accent)';
        poolBtn.addEventListener('click', function () {
            commitItemFields();
            moveItem(currentItemId, 'pool');
            closeItemModal();
            toast('已退回内容池');
        });
        els.tierButtons.appendChild(poolBtn);
    }

    function commitItemFields() {
        var item = getItem(currentItemId);
        if (!item) return;
        item.name = (els.itemName.value || '').trim() || '未命名';
        item.note = (els.itemNote.value || '').trim();
        scheduleSave();
    }

    function closeItemModal() {
        els.itemModal.classList.remove('is-open');
        currentItemId = null;
        renderItems();
        updatePresentationStage();
    }

    function stepItem(direction) {
        var item = getItem(currentItemId);
        if (!item) return;
        var list = itemsOf(item.tier);
        if (!list.length) return;
        var index = list.findIndex(function (entry) { return entry.id === item.id; });
        var next = list[(index + direction + list.length) % list.length];
        commitItemFields();
        currentItemId = next.id;
        fillItemModal(next);
    }

    /* ---------------------------------------------------------------- */
    /* 搜索与筛选                                                        */
    /* ---------------------------------------------------------------- */

    function applyFilters() {
        var keyword = (els.searchInput.value || '').trim().toLowerCase();
        var tierValue = els.tierFilter.value;
        var noteValue = els.noteFilter.value;
        var matched = 0;

        state.images.forEach(function (item) {
            var node = document.querySelector('.item[data-id="' + item.id + '"]');
            if (!node) return;
            var ok = true;
            if (keyword && (item.name + ' ' + (item.note || '')).toLowerCase().indexOf(keyword) === -1) ok = false;
            if (ok && tierValue !== 'all' && item.tier !== tierValue) ok = false;
            if (ok && noteValue === 'with' && !(item.note || '').trim()) ok = false;
            if (ok && noteValue === 'without' && (item.note || '').trim()) ok = false;
            node.classList.toggle('is-muted', !ok);
            if (ok) matched += 1;
        });

        var total = state.images.length;
        var active = keyword || tierValue !== 'all' || noteValue !== 'all';
        els.boardStatus.textContent = total === 0
            ? '还没有内容。用左侧「上传图片」或「加入内容池」开始吧。'
            : (active
                ? '筛选生效：符合条件 ' + matched + ' / ' + total + ' 项'
                : '当前显示全部 ' + total + ' 项内容 · 拖拽卡片即可排名');
    }

    /* ---------------------------------------------------------------- */
    /* 摘要                                                              */
    /* ---------------------------------------------------------------- */

    function buildSummaryText() {
        var lines = [];
        lines.push(state.boardTitle);
        lines.push('更新时间：' + formatTime(Date.now()));
        lines.push('');
        tiers.forEach(function (tier) {
            var list = itemsOf(tier.key);
            lines.push('【' + tier.label + '】' + (list.length ? '' : ' 暂无'));
            list.forEach(function (item, index) {
                lines.push((index + 1) + '. ' + item.name + (item.note ? ' —— ' + item.note : ''));
            });
            lines.push('');
        });
        var pool = itemsOf('pool');
        lines.push('【待处理】' + (pool.length ? ' ' + pool.map(function (item) { return item.name; }).join('、') : ' 无'));
        return lines.join('\n').trim();
    }

    function renderSummary() {
        els.summaryText.textContent = state.images.length
            ? buildSummaryText()
            : '暂无内容，先上传图片或添加文字项吧。';
    }

    function copyText(text, message) {
        if (!text) { toast('没有可复制的内容'); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast(message); }, function () { fallbackCopy(text, message); });
        } else {
            fallbackCopy(text, message);
        }
    }

    function fallbackCopy(text, message) {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            toast(message);
        } catch (_) {
            toast('复制失败，请手动选择文本');
        }
        area.remove();
    }

    /* ---------------------------------------------------------------- */
    /* 添加内容                                                          */
    /* ---------------------------------------------------------------- */

    function addFiles(files, label) {
        var imageFiles = Array.prototype.slice.call(files || []).filter(function (file) {
            return file && file.type && file.type.indexOf('image/') === 0;
        });
        if (!imageFiles.length) { toast('没有检测到可用图片'); return; }

        var baseOrder = itemsOf('pool').length;
        Promise.all(imageFiles.map(readFileAsDataUrl)).then(function (urls) {
            urls.forEach(function (src, index) {
                state.images.push({
                    id: uid(),
                    src: src,
                    kind: 'image',
                    name: (imageFiles[index].name || '未命名').replace(/\.[^.]+$/, '') || '未命名',
                    note: '',
                    createdAt: Date.now(),
                    tier: 'pool',
                    order: baseOrder + index
                });
            });
            renderItems();
            scheduleSave();
            toast((label || '上传') + '完成，共 ' + urls.length + ' 张');
        }).catch(function (error) {
            toast('读取图片失败：' + error.message);
        });
    }

    function addTextItems(raw) {
        var entries = String(raw || '')
            .split(/[\n,，;；]+/)
            .map(function (text) { return text.trim(); })
            .filter(Boolean);
        if (!entries.length) { toast('先输入至少一个名称'); return; }

        var baseOrder = itemsOf('pool').length;
        entries.forEach(function (name, index) {
            state.images.push({
                id: uid(),
                src: '',
                kind: 'text',
                name: name,
                note: '',
                createdAt: Date.now(),
                tier: 'pool',
                order: baseOrder + index
            });
        });
        els.textItemInput.value = '';
        renderItems();
        scheduleSave();
        toast('已加入 ' + entries.length + ' 个文字项');
    }

    /* ---------------------------------------------------------------- */
    /* 显示设置                                                          */
    /* ---------------------------------------------------------------- */

    function applyDisplay() {
        els.app.dataset.compact = els.compactToggle.checked ? '1' : '0';
        els.app.dataset.hideNames = els.nameToggle.checked ? '0' : '1';
        els.app.dataset.hideNotes = els.noteToggle.checked ? '0' : '1';
        els.app.dataset.tierStyle = els.tierStyleSelect.value;
    }

    function applyTheme(theme) {
        var next = ['black-gold', 'deep-space', 'cream'].indexOf(theme) >= 0 ? theme : 'black-gold';
        document.body.dataset.theme = next;
        document.querySelectorAll('#themeRow .theme-chip').forEach(function (chip) {
            chip.classList.toggle('is-active', chip.dataset.theme === next);
        });
    }

    function applyPoolSort() {
        var mode = els.sortSelect.value;
        if (mode === 'manual') return;
        var pool = itemsOf('pool');
        pool.sort(function (a, b) {
            if (mode === 'name-asc') return a.name.localeCompare(b.name, 'zh-CN');
            if (mode === 'newest') return b.createdAt - a.createdAt;
            return a.createdAt - b.createdAt;
        });
        pool.forEach(function (item, index) { item.order = index; });
    }

    /* ---------------------------------------------------------------- */
    /* 导出                                                              */
    /* ---------------------------------------------------------------- */

    function buildExportStage() {
        var stage = el('div', 'export-stage');
        stage.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1;width:1500px;padding:30px;'
            + 'background:linear-gradient(180deg,#100d07 0%,#080705 100%);color:#f7f1e3;'
            + 'font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;';

        if (els.exportTitleToggle.checked) {
            var head = el('div');
            head.style.marginBottom = '18px';
            var title = el('h1', null, state.boardTitle);
            title.style.cssText = 'font:800 34px/1.3 inherit;color:#f0d79a;margin:0;';
            head.appendChild(title);
            var total = state.images.length;
            var ranked = state.images.filter(function (item) { return item.tier !== 'pool'; }).length;
            var meta = el('div', null, '共 ' + total + ' 项 · 已入榜 ' + ranked + ' 项 · 导出时间 ' + formatTime(Date.now()));
            meta.style.cssText = 'font:400 14px/1.7 inherit;color:#9c907a;margin-top:4px;';
            head.appendChild(meta);
            stage.appendChild(head);
        }

        var wrapper = el('div', 'tiers');
        tiers.forEach(function (tier) {
            var colors = tierColors(tier);
            var row = el('div', 'tier-row');
            row.style.gridTemplateColumns = '170px 1fr';

            var label = el('div', 'tier-label');
            label.style.setProperty('--tier-a', colors.start);
            label.style.setProperty('--tier-b', colors.end);
            label.style.setProperty('--tier-ink', colors.ink);
            label.style.background = 'linear-gradient(160deg, ' + colors.start + ', ' + colors.end + ')';
            label.appendChild(el('div', 'tier-label__name', tier.label));
            label.appendChild(el('div', 'tier-label__desc', tier.description));
            label.appendChild(el('span', 'tier-label__count', String(itemsOf(tier.key).length)));

            var drop = el('div', 'tier-drop');
            drop.style.gridTemplateColumns = 'repeat(auto-fill, minmax(136px, 1fr))';
            drop.style.background = 'rgba(255,249,235,.035)';
            var list = itemsOf(tier.key);
            if (!list.length) {
                drop.appendChild(el('span', 'drop-hint', '暂无内容'));
            } else {
                list.forEach(function (item) {
                    var card = el('div', 'item');
                    card.style.background = 'rgba(255,249,235,.06)';
                    var media = el('div', 'item__media');
                    if (item.kind === 'text' || !item.src) {
                        media.appendChild(el('div', 'item__text', item.name));
                    } else {
                        var img = el('img');
                        img.src = item.src;
                        img.alt = item.name;
                        media.appendChild(img);
                    }
                    card.appendChild(media);
                    var name = el('div', 'item__name', item.name);
                    name.style.color = '#f7f1e3';
                    card.appendChild(name);
                    if (item.note) {
                        var note = el('div', 'item__note', item.note);
                        note.style.color = '#b8ab90';
                        card.appendChild(note);
                    }
                    drop.appendChild(card);
                });
            }

            row.appendChild(label);
            row.appendChild(drop);
            wrapper.appendChild(row);
        });
        stage.appendChild(wrapper);

        if (els.exportPoolToggle.checked) {
            var pool = itemsOf('pool');
            var wrap = el('div');
            wrap.style.marginTop = '20px';
            var poolTitle = el('div', null, '待排名内容池（' + pool.length + ' 项）');
            poolTitle.style.cssText = 'font:700 15px/1.6 inherit;color:#f0d79a;margin-bottom:10px;';
            wrap.appendChild(poolTitle);
            var poolDrop = el('div', 'tier-drop');
            if (!pool.length) {
                poolDrop.appendChild(el('span', 'drop-hint', '内容池为空'));
            } else {
                pool.forEach(function (item) {
                    var card = el('div', 'item');
                    var media = el('div', 'item__media');
                    if (item.kind === 'text' || !item.src) {
                        media.appendChild(el('div', 'item__text', item.name));
                    } else {
                        var img = el('img');
                        img.src = item.src;
                        media.appendChild(img);
                    }
                    card.appendChild(media);
                    card.appendChild(el('div', 'item__name', item.name));
                    poolDrop.appendChild(card);
                });
            }
            wrap.appendChild(poolDrop);
            stage.appendChild(wrap);
        }

        if (els.exportSummaryToggle.checked) {
            var box = el('div');
            box.style.cssText = 'margin-top:22px;padding:18px;border:1px solid rgba(214,176,92,.2);border-radius:16px;'
                + 'font:400 13px/1.9 inherit;color:#d9cfb8;white-space:pre-wrap;';
            box.textContent = buildSummaryText();
            stage.appendChild(box);
        }

        return stage;
    }

    function runExport() {
        els.exportModal.classList.remove('is-open');
        setSaveState('saving', '正在导出图片…');

        var stage = buildExportStage();
        document.body.appendChild(stage);

        return new Promise(function (resolve) {
            window.setTimeout(function () {
                if (typeof window.html2canvas !== 'function') {
                    stage.remove();
                    setSaveState('error', '导出失败：缺少 web/vendor/html2canvas.min.js');
                    toast('导出失败，缺少图片渲染组件');
                    resolve(null);
                    return;
                }
                html2canvas(stage, {
                    scale: 1.4,
                    backgroundColor: null,
                    useCORS: true,
                    logging: false,
                    width: 1500,
                    windowWidth: 1500
                }).then(function (canvas) {
                    var link = document.createElement('a');
                    var safeTitle = (state.boardTitle || '从夯到拉排名').replace(/[\\/:*?"<>|]+/g, '-');
                    link.download = safeTitle + '.png';
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    setSaveState('saved', '图片已导出 · ' + canvas.width + '×' + canvas.height);
                    toast('图片已导出');
                    resolve(canvas);
                }).catch(function (error) {
                    setSaveState('error', '导出失败：' + (error && error.message ? error.message : error));
                    toast('导出失败');
                    resolve(null);
                }).then(function () {
                    stage.remove();
                });
            }, 240);
        });
    }

    function exportJson() {
        syncFromDom();
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = (state.boardTitle || '从夯到拉排名').replace(/[\\/:*?"<>|]+/g, '-') + '.json';
        link.click();
        window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
        toast('JSON 快照已导出');
    }

    function importJson(file) {
        var reader = new FileReader();
        reader.onload = function (event) {
            try {
                applyState(JSON.parse(event.target.result));
                toast('快照已导入');
                saveNow();
            } catch (error) {
                toast('JSON 解析失败：' + error.message);
            }
        };
        reader.readAsText(file, 'utf-8');
    }

    function applyState(raw) {
        state = createState(raw);
        tiers = state.tiers;
        settings = state.settings;
        fillControls();
        renderBoard();
        applyPoolSort();
        renderItems();
    }

    /* ---------------------------------------------------------------- */
    /* 演示模式                                                          */
    /* ---------------------------------------------------------------- */

    function togglePresentation() {
        var on = !document.body.classList.contains('presenting');
        setPresentation(on);
    }

    function setPresentation(on) {
        document.body.classList.toggle('presenting', on);
        els.presentBtn.textContent = on ? '退出演示' : '演示模式';
        els.presentBtn.classList.toggle('is-on', on);
        els.exportModal.classList.remove('is-open');
        if (!on) {
            presentationItemId = null;
            presentationLastHandledName = '';
        }
        setFullscreen(on);
        updatePresentationStage();
        if (on && !presentationItemId) summonNext();
    }

    /* 演示模式自动全屏：去掉浏览器窗口边框，录视频更干净。
       只有「确实进过全屏」才在全屏变化时退出演示，避免环境不支持全屏时误退出。 */
    var presentationFullscreen = false;

    function setFullscreen(on) {
        try {
            if (on) {
                if (document.fullscreenElement) {
                    presentationFullscreen = true;
                    return;
                }
                if (!document.documentElement.requestFullscreen) return;
                var request = document.documentElement.requestFullscreen();
                if (request && request.then) {
                    request.then(function () { presentationFullscreen = true; })
                        .catch(function () { presentationFullscreen = false; });
                }
            } else {
                presentationFullscreen = false;
                if (document.fullscreenElement) {
                    var exit = document.exitFullscreen();
                    if (exit && exit.catch) exit.catch(function () { /* 忽略 */ });
                }
            }
        } catch (_) {
            presentationFullscreen = false;
        }
    }

    /* 底部悬浮按钮的状态：待处理数量 / 当前是否已召唤出一张 */
    function updatePresentationStage() {
        if (!els.summonBar) return;
        var poolCount = itemsOf('pool').length;
        var current = presentationItemId ? getItem(presentationItemId) : null;
        var isCurrentInPool = Boolean(current && current.tier === 'pool');

        if (!isCurrentInPool) presentationItemId = null;

        if (isCurrentInPool) {
            els.summonBtn.textContent = '继续当前内容';
            els.summonBtn.disabled = false;
            els.summonBtn.title = '继续编辑并放置当前召唤出来的内容';
        } else if (poolCount > 0) {
            els.summonBtn.textContent = '召唤下一张';
            els.summonBtn.disabled = false;
            els.summonBtn.title = presentationLastHandledName
                ? '上一张已处理：' + presentationLastHandledName + '（快捷键 N）'
                : '点击弹出下一张待处理内容（快捷键 N）';
        } else {
            els.summonBtn.textContent = '已全部处理';
            els.summonBtn.disabled = true;
            els.summonBtn.title = presentationLastHandledName
                ? '内容池已清空，上一张：' + presentationLastHandledName
                : '内容池已经没有待处理内容了';
        }
    }

    function summonNext() {
        if (!document.body.classList.contains('presenting')) return;

        var current = presentationItemId ? getItem(presentationItemId) : null;
        if (current && current.tier === 'pool') {
            openItemModal(current.id);
            return;
        }

        var pool = itemsOf('pool');
        if (!pool.length) {
            presentationItemId = null;
            updatePresentationStage();
            toast('内容池已经没有待处理内容了');
            return;
        }

        presentationItemId = pool[0].id;
        updatePresentationStage();
        openItemModal(presentationItemId);
    }

    /* ---------------------------------------------------------------- */
    /* 弹窗控制                                                          */
    /* ---------------------------------------------------------------- */

    function bindModal(modal, closeBtn) {
        closeBtn.addEventListener('click', function () { modal.classList.remove('is-open'); });
        modal.addEventListener('click', function (event) {
            if (event.target === modal) modal.classList.remove('is-open');
        });
    }

    /* ---------------------------------------------------------------- */
    /* 启动                                                              */
    /* ---------------------------------------------------------------- */

    function cacheElements() {
        [
            'app', 'topbarTools', 'saveState', 'saveStateText', 'importBtn', 'exportJsonBtn', 'presentBtn',
            'fullscreenBtn', 'exportBtn', 'helpBtn', 'boardTitleInput', 'searchInput', 'statRatio', 'statTotal',
            'statRanked', 'statPending', 'statRate', 'tierList', 'settingsPanel', 'sortSelect', 'tierStyleSelect',
            'themeRow', 'compactToggle', 'nameToggle', 'noteToggle', 'uploadBtn', 'addTextFocusBtn', 'clearPoolBtn',
            'textItemInput', 'addTextBtn', 'poolGrid', 'poolCountLabel', 'resetRankedBtn', 'boardTitleDisplay', 'tierFilter', 'noteFilter',
            'clearFilterBtn', 'boardStatus', 'tierContainer', 'refreshSummaryBtn', 'copySummaryBtn', 'summaryText',
            'itemModal', 'itemModalClose', 'itemModalTitle', 'itemPreview', 'itemName', 'itemNote', 'itemMeta',
            'tierButtons', 'itemSaveBtn', 'itemPrevBtn', 'itemNextBtn', 'itemPoolBtn', 'itemDeleteBtn',
            'tierModal', 'tierModalClose', 'tierModalTitle', 'tierLabelInput', 'tierDescInput', 'tierSwatches',
            'tierModalSave', 'tierModalDelete',
            'exportModal', 'exportModalClose', 'exportModalTitle', 'exportHint', 'exportTitleToggle',
            'exportPoolToggle', 'exportSummaryToggle', 'exportRunBtn', 'exportCancelBtn', 'helpModal',
            'helpModalClose', 'summonBar', 'summonBtn', 'toasts', 'fileInput', 'jsonInput'
        ].forEach(function (id) { els[id] = $(id); });
    }

    function fillControls() {
        els.boardTitleInput.value = state.boardTitle;
        els.boardTitleDisplay.textContent = state.boardTitle;
        document.title = state.boardTitle;
        els.searchInput.value = settings.search || '';
        els.sortSelect.value = settings.sort || 'manual';
        els.tierStyleSelect.value = settings.tierStyle || 'card';
        els.compactToggle.checked = Boolean(settings.compact);
        els.nameToggle.checked = settings.showNames !== false;
        els.noteToggle.checked = Boolean(settings.showNotes);
        els.exportTitleToggle.checked = settings.exportOptions.showTitle !== false;
        els.exportPoolToggle.checked = Boolean(settings.exportOptions.showPool);
        els.exportSummaryToggle.checked = Boolean(settings.exportOptions.showSummary);

        els.tierFilter.innerHTML = '<option value="all">全部赛道</option>';
        tiers.forEach(function (tier) {
            var option = document.createElement('option');
            option.value = tier.key;
            option.textContent = tier.label;
            els.tierFilter.appendChild(option);
        });
        els.tierFilter.value = settings.tierFilter || 'all';
        els.noteFilter.value = settings.noteFilter || 'all';

        applyTheme(settings.theme || 'black-gold');
        applyDisplay();
    }

    function bindEvents() {
        /* 标题 */
        els.boardTitleInput.addEventListener('input', function () {
            state.boardTitle = (els.boardTitleInput.value || '').trim() || '从夯到拉 · 排名工坊';
            els.boardTitleDisplay.textContent = state.boardTitle;
            document.title = state.boardTitle;
            renderSummary();
            scheduleSave();
        });
        els.boardTitleDisplay.addEventListener('dblclick', editBoardTitle);

        /* 筛选 */
        var onFilter = debounce(function () { applyFilters(); scheduleSave(); }, 150);
        els.searchInput.addEventListener('input', onFilter);
        els.tierFilter.addEventListener('change', function () { applyFilters(); scheduleSave(); });
        els.noteFilter.addEventListener('change', function () { applyFilters(); scheduleSave(); });
        els.clearFilterBtn.addEventListener('click', function () {
            els.searchInput.value = '';
            els.tierFilter.value = 'all';
            els.noteFilter.value = 'all';
            applyFilters();
            scheduleSave();
        });

        /* 设置 */
        els.sortSelect.addEventListener('change', function () {
            applyPoolSort();
            renderItems();
            scheduleSave();
        });
        els.tierStyleSelect.addEventListener('change', function () {
            settings.tierStyle = els.tierStyleSelect.value;
            applyDisplay();
            scheduleSave();
        });
        els.compactToggle.addEventListener('change', function () { applyDisplay(); scheduleSave(); });
        els.nameToggle.addEventListener('change', function () { applyDisplay(); scheduleSave(); });
        els.noteToggle.addEventListener('change', function () { applyDisplay(); scheduleSave(); });
        document.querySelectorAll('#themeRow .theme-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                settings.theme = chip.dataset.theme;
                applyTheme(settings.theme);
                scheduleSave();
                toast('已切换主题');
            });
        });

        /* 内容池 */
        els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
        els.fileInput.addEventListener('change', function (event) {
            addFiles(event.target.files, '上传');
            els.fileInput.value = '';
        });
        els.addTextFocusBtn.addEventListener('click', function () { els.textItemInput.focus(); });
        els.clearPoolBtn.addEventListener('click', clearPool);
        els.resetRankedBtn.addEventListener('click', resetRanked);
        els.addTextBtn.addEventListener('click', function () { addTextItems(els.textItemInput.value); });
        els.textItemInput.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                addTextItems(els.textItemInput.value);
            }
        });

        /* 拖文件进内容池 */
        ['dragenter', 'dragover'].forEach(function (type) {
            els.poolGrid.addEventListener(type, function (event) {
                if (!event.dataTransfer || Array.prototype.slice.call(event.dataTransfer.types || []).indexOf('Files') < 0) return;
                event.preventDefault();
                if (type === 'dragenter') dragDepth += 1;
                els.poolGrid.classList.add('file-drag-over');
            });
        });
        els.poolGrid.addEventListener('dragleave', function () {
            dragDepth = Math.max(0, dragDepth - 1);
            if (!dragDepth) els.poolGrid.classList.remove('file-drag-over');
        });
        els.poolGrid.addEventListener('dragover', function (event) {
            if (Array.prototype.slice.call((event.dataTransfer && event.dataTransfer.types) || []).indexOf('Files') >= 0) return;
            event.preventDefault();
            els.poolGrid.classList.add('drag-over');
        });
        els.poolGrid.addEventListener('dragleave', function () {
            els.poolGrid.classList.remove('drag-over');
        });
        els.poolGrid.addEventListener('drop', function (event) {
            event.preventDefault();
            dragDepth = 0;
            els.poolGrid.classList.remove('file-drag-over', 'drag-over');
            var files = Array.prototype.slice.call((event.dataTransfer && event.dataTransfer.files) || []);
            if (files.length) {
                addFiles(files, '拖拽上传');
                return;
            }
            var id = event.dataTransfer.getData('text/plain');
            if (!id || !getItem(id)) return;
            moveItem(id, 'pool', findReference(els.poolGrid, event, id));
        });

        /* 详情弹窗 */
        bindModal(els.itemModal, els.itemModalClose);
        els.itemSaveBtn.addEventListener('click', function () {
            commitItemFields();
            var item = getItem(currentItemId);
            renderItems();
            if (item) fillItemModal(item);
            toast('已保存');
        });
        els.itemPrevBtn.addEventListener('click', function () { stepItem(-1); });
        els.itemNextBtn.addEventListener('click', function () { stepItem(1); });
        els.itemPoolBtn.addEventListener('click', function () {
            commitItemFields();
            moveItem(currentItemId, 'pool');
            closeItemModal();
            toast('已退回内容池');
        });
        els.itemDeleteBtn.addEventListener('click', function () { deleteItem(currentItemId); });

        /* 赛道编辑弹窗 */
        bindModal(els.tierModal, els.tierModalClose);
        els.tierModalSave.addEventListener('click', function () {
            saveTierModal();
            els.tierModal.classList.remove('is-open');
            toast('赛道已更新');
        });
        els.tierModalDelete.addEventListener('click', function () {
            var key = currentTierKey;
            els.tierModal.classList.remove('is-open');
            removeTier(key);
        });

        /* 导出 */
        els.exportBtn.addEventListener('click', function () {
            els.exportModal.classList.add('is-open');
        });
        bindModal(els.exportModal, els.exportModalClose);
        els.exportCancelBtn.addEventListener('click', function () { els.exportModal.classList.remove('is-open'); });
        els.exportRunBtn.addEventListener('click', function () {
            settings.exportOptions = {
                showTitle: els.exportTitleToggle.checked,
                showPool: els.exportPoolToggle.checked,
                showSummary: els.exportSummaryToggle.checked
            };
            void runExport();
        });
        els.exportJsonBtn.addEventListener('click', exportJson);
        els.importBtn.addEventListener('click', function () { els.jsonInput.click(); });
        els.jsonInput.addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            if (file) importJson(file);
            els.jsonInput.value = '';
        });

        /* 摘要 */
        els.refreshSummaryBtn.addEventListener('click', function () { renderSummary(); toast('摘要已刷新'); });
        els.copySummaryBtn.addEventListener('click', function () { copyText(buildSummaryText(), '摘要已复制'); });

        /* 演示 / 全屏 / 帮助 */
        els.presentBtn.addEventListener('click', togglePresentation);
        els.summonBtn.addEventListener('click', summonNext);
        els.fullscreenBtn.addEventListener('click', function () {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(function () { /* 忽略 */ });
            } else {
                document.documentElement.requestFullscreen().catch(function () { toast('当前环境不支持全屏'); });
            }
        });
        els.helpBtn.addEventListener('click', function () { els.helpModal.classList.add('is-open'); });
        bindModal(els.helpModal, els.helpModalClose);

        /* 快捷键 */
        document.addEventListener('keydown', function (event) {
            var key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 's') {
                event.preventDefault();
                els.exportModal.classList.add('is-open');
                return;
            }
            if ((event.ctrlKey || event.metaKey) && key === 'f') {
                event.preventDefault();
                els.searchInput.focus();
                els.searchInput.select();
                return;
            }
            if (event.key === 'Escape') {
                document.querySelectorAll('.modal.is-open').forEach(function (modal) { modal.classList.remove('is-open'); });
                if (document.body.classList.contains('presenting')) setPresentation(false);
                return;
            }
            if (els.itemModal.classList.contains('is-open')) {
                if (event.key === 'ArrowLeft') { event.preventDefault(); stepItem(-1); }
                if (event.key === 'ArrowRight') { event.preventDefault(); stepItem(1); }
            }
            if (document.body.classList.contains('presenting') && key === 'n') {
                var tag = (event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '');
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                event.preventDefault();
                summonNext();
            }
        });

        /* 粘贴图片 */
        document.addEventListener('paste', function (event) {
            var items = Array.prototype.slice.call((event.clipboardData && event.clipboardData.items) || []);
            var files = items
                .filter(function (item) { return item.type && item.type.indexOf('image/') === 0; })
                .map(function (item) { return item.getAsFile(); })
                .filter(Boolean);
            if (files.length) addFiles(files, '粘贴上传');
        });

        /* 用户用 Esc / F11 退出全屏时，演示模式也跟着退出，保持状态一致 */
        document.addEventListener('fullscreenchange', function () {
            if (document.fullscreenElement) {
                if (document.body.classList.contains('presenting')) presentationFullscreen = true;
                return;
            }
            if (presentationFullscreen && document.body.classList.contains('presenting')) {
                presentationFullscreen = false;
                setPresentation(false);
            }
        });

        window.addEventListener('beforeunload', function () {
            if (state) {
                syncFromDom();
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* 忽略 */ }
            }
        });

        window.setInterval(function () {
            if (lastSaveAt) setSaveState('saved', '已保存 · ' + formatTime(lastSaveAt));
        }, 30000);
    }

    function loadState() {
        fetch('/api/state', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (raw) {
                applyState(raw);
                setSaveState('saved', '数据已就绪');
            })
            .catch(function () {
                var local = null;
                try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { local = null; }
                applyState(local);
                setSaveState('error', '未连接到本地服务，改动只存在浏览器缓存');
            });
    }

    cacheElements();
    bindEvents();
    applyState(null);
    loadState();
})();
