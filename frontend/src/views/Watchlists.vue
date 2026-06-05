<template>
  <div class="watchlists-page">
    <div class="page-header">
      <h2>我的片单</h2>
      <div class="header-actions">
        <el-button @click="openImportDialog">导入片单</el-button>
        <el-button type="primary" @click="openCreateDialog">新建片单</el-button>
      </div>
    </div>

    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="list in watchlists" :key="list.id" :xs="24" :sm="12" :md="8" :lg="6">
        <el-card class="watchlist-card" shadow="hover" @click="openDetail(list)">
          <div class="card-title">{{ list.name }}</div>
          <div class="card-desc">{{ list.description || '暂无说明' }}</div>
          <div class="card-meta">
            <span>{{ list.item_count || 0 }} 部</span>
            <el-tag v-if="list.auto_fill_enabled" size="small" type="success">自动补缺</el-tag>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-empty v-if="!loading && watchlists.length === 0" description="还没有片单，先创建一个吧" />

    <el-dialog v-model="importVisible" title="导入片单" width="720px">
      <el-form :model="importForm" label-width="100px">
        <el-tabs v-model="importForm.category_key" class="import-tabs">
          <el-tab-pane
            v-for="category in importCatalog"
            :key="category.key"
            :label="category.label"
            :name="category.key"
          >
            <el-text size="small" type="info" class="category-desc">{{ category.description }}</el-text>
            <div class="source-grid">
              <button
                v-for="item in category.items"
                :key="item.key"
                type="button"
                class="source-card"
                :class="{ active: importForm.source_key === item.key }"
                @click="selectImportSource(item)"
              >
                <span class="source-card-label">{{ item.label }}</span>
                <span class="source-card-desc">{{ item.description }}</span>
              </button>
            </div>
          </el-tab-pane>
        </el-tabs>

        <el-form-item
          v-if="activeImportItem?.requires_reference"
          label="链接或 ID"
          required
        >
          <el-input
            v-model="importForm.reference"
            :placeholder="activeImportItem?.example_url || '粘贴 TMDB 链接或填写数字 ID'"
          />
        </el-form-item>
        <el-form-item v-if="importForm.source_key">
          <el-button :loading="previewing" @click="handlePreviewImport">预览片单</el-button>
        </el-form-item>

        <template v-if="importPreview">
          <el-divider content-position="left">预览</el-divider>
          <el-alert type="info" :closable="false" class="preview-alert">
            <div class="preview-title">{{ importPreview.name }}</div>
            <div v-if="importPreview.description" class="preview-desc">{{ importPreview.description }}</div>
            <div class="preview-meta">
              共 {{ importPreview.item_count || 0 }} 部
              <span v-if="importPreview.movie_count">（电影 {{ importPreview.movie_count }}</span>
              <span v-if="importPreview.tv_count">，剧集 {{ importPreview.tv_count }}</span>
              <span v-if="importPreview.movie_count || importPreview.tv_count">）</span>
              <span v-if="importPreview.watch_region"> · 片库地区 {{ importPreview.watch_region }}</span>
            </div>
          </el-alert>
          <div v-if="importPreview.sample_items?.length" class="preview-grid">
            <div v-for="item in importPreview.sample_items" :key="`${item.media_type}-${item.tmdb_id}`" class="preview-card">
              <img v-if="item.poster_path" :src="getPosterUrl(item.poster_path)" :alt="item.title" />
              <div v-else class="poster-placeholder">无海报</div>
              <span class="preview-card-title">{{ item.title }}</span>
            </div>
          </div>
        </template>

        <el-divider content-position="left">导入设置</el-divider>
        <el-form-item label="导入方式">
          <el-radio-group v-model="importForm.mode">
            <el-radio-button value="new">新建片单</el-radio-button>
            <el-radio-button value="merge" :disabled="watchlists.length === 0">合并到已有</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="importForm.mode === 'merge'" label="目标片单">
          <el-select v-model="importForm.watchlist_id" placeholder="选择片单" style="width: 100%">
            <el-option
              v-for="list in watchlists"
              :key="list.id"
              :label="`${list.name} (${list.item_count || 0})`"
              :value="list.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="importForm.mode === 'new'" label="片单名称">
          <el-input v-model="importForm.name" maxlength="120" show-word-limit placeholder="留空则使用来源名称" />
        </el-form-item>
        <el-form-item label="自动补缺">
          <el-switch v-model="importForm.auto_fill_enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importPreview" @click="handleImport">
          确认导入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createVisible" title="新建片单" width="480px">
      <el-form :model="createForm" label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="createForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="自动补缺">
          <el-switch v-model="createForm.auto_fill_enabled" />
          <el-text size="small" type="info" style="margin-left: 8px">手动触发时为未订阅条目创建订阅</el-text>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" :title="activeWatchlist?.name || '片单详情'" size="72%">
      <div v-if="activeWatchlist" class="detail-panel" v-loading="detailLoading">
        <div class="detail-toolbar">
          <el-text type="info">{{ activeWatchlist.description || '暂无说明' }}</el-text>
          <div class="toolbar-actions">
            <el-button type="primary" :loading="filling" @click="handleFill">补缺订阅</el-button>
            <el-button type="danger" plain @click="handleDeleteWatchlist">删除片单</el-button>
          </div>
        </div>
        <div class="items-grid">
          <el-card v-for="item in activeWatchlist.items || []" :key="item.id" class="item-card">
            <div class="item-poster" @click="goToDetail(item)">
              <img v-if="item.poster_path" :src="getPosterUrl(item.poster_path)" :alt="item.title" />
              <div v-else class="poster-placeholder">暂无海报</div>
            </div>
            <div class="item-info">
              <div class="item-title" @click="goToDetail(item)">{{ item.title }}</div>
              <div class="item-meta">
                <el-tag size="small" :type="item.media_type === 'movie' ? 'primary' : 'success'">
                  {{ item.media_type === 'movie' ? '电影' : '电视剧' }}
                </el-tag>
                <span v-if="item.year">{{ item.year }}</span>
              </div>
              <el-button size="small" type="danger" plain @click="handleRemoveItem(item)">移除</el-button>
            </div>
          </el-card>
        </div>
        <el-empty v-if="!(activeWatchlist.items || []).length" description="片单还是空的" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { watchlistApi } from '@/api'
import { TMDB_DEFAULT_IMAGE_BASE_URL } from '@/utils/tmdb'

const router = useRouter()
const loading = ref(false)
const watchlists = ref([])
const createVisible = ref(false)
const saving = ref(false)
const createForm = ref({
  name: '',
  description: '',
  auto_fill_enabled: false
})
const detailVisible = ref(false)
const detailLoading = ref(false)
const filling = ref(false)
const activeWatchlist = ref(null)
const importVisible = ref(false)
const importCatalog = ref([])
const importPreview = ref(null)
const previewing = ref(false)
const importing = ref(false)
const importForm = ref({
  category_key: 'streaming',
  source_key: '',
  reference: '',
  mode: 'new',
  watchlist_id: null,
  name: '',
  auto_fill_enabled: false
})

const activeImportItem = computed(() => {
  for (const category of importCatalog.value) {
    const matched = (category.items || []).find(item => item.key === importForm.value.source_key)
    if (matched) return matched
  }
  return null
})

const getPosterUrl = (path) => {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${TMDB_DEFAULT_IMAGE_BASE_URL}${path}`
}

const fetchWatchlists = async () => {
  loading.value = true
  try {
    const { data } = await watchlistApi.list()
    watchlists.value = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载片单失败')
  } finally {
    loading.value = false
  }
}

const loadImportCatalog = async () => {
  try {
    const { data } = await watchlistApi.getImportCatalog()
    importCatalog.value = Array.isArray(data?.categories) ? data.categories : []
  } catch {
    importCatalog.value = []
  }
}

const selectImportSource = (item) => {
  importForm.value.source_key = item.key
  importForm.value.reference = ''
  importPreview.value = null
  if (!item.requires_reference) {
    handlePreviewImport()
  }
}

const openImportDialog = async () => {
  if (!importCatalog.value.length) {
    await loadImportCatalog()
  }
  const firstCategory = importCatalog.value[0]
  const firstItem = firstCategory?.items?.[0]
  importForm.value = {
    category_key: firstCategory?.key || 'streaming',
    source_key: firstItem?.key || '',
    reference: '',
    mode: 'new',
    watchlist_id: watchlists.value[0]?.id || null,
    name: '',
    auto_fill_enabled: false
  }
  importPreview.value = null
  importVisible.value = true
  if (firstItem && !firstItem.requires_reference) {
    await handlePreviewImport()
  }
}

const handlePreviewImport = async () => {
  const sourceKey = String(importForm.value.source_key || '').trim()
  if (!sourceKey) {
    ElMessage.warning('请选择要导入的片单来源')
    return
  }
  const reference = String(importForm.value.reference || '').trim()
  if (activeImportItem.value?.requires_reference && !reference) {
    ElMessage.warning('请填写 TMDB 链接或 ID')
    return
  }
  previewing.value = true
  try {
    const payload = { source_key: sourceKey }
    if (reference) payload.reference = reference
    const { data } = await watchlistApi.previewImport(payload)
    importPreview.value = data
    if (importForm.value.mode === 'new' && !importForm.value.name) {
      importForm.value.name = data.name || ''
    }
  } catch (error) {
    importPreview.value = null
    ElMessage.error(error.response?.data?.detail || '预览失败')
  } finally {
    previewing.value = false
  }
}

const handleImport = async () => {
  if (!importPreview.value) {
    ElMessage.warning('请先预览片单内容')
    return
  }
  if (importForm.value.mode === 'merge' && !importForm.value.watchlist_id) {
    ElMessage.warning('请选择要合并的目标片单')
    return
  }
  importing.value = true
  try {
    const payload = {
      source_key: importForm.value.source_key,
      auto_fill_enabled: importForm.value.auto_fill_enabled
    }
    if (importForm.value.reference) {
      payload.reference = importForm.value.reference
    }
    if (importForm.value.mode === 'merge') {
      payload.watchlist_id = importForm.value.watchlist_id
    } else if (importForm.value.name) {
      payload.name = importForm.value.name
    }
    const { data } = await watchlistApi.importFromTmdb(payload)
    importVisible.value = false
    ElMessage.success(data.message || '导入成功')
    await fetchWatchlists()
    if (data.watchlist_id) {
      await openDetail({ id: data.watchlist_id, name: data.watchlist_name })
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '导入失败')
  } finally {
    importing.value = false
  }
}

const openCreateDialog = () => {
  createForm.value = { name: '', description: '', auto_fill_enabled: false }
  createVisible.value = true
}

const handleCreate = async () => {
  const name = String(createForm.value.name || '').trim()
  if (!name) {
    ElMessage.warning('请输入片单名称')
    return
  }
  saving.value = true
  try {
    await watchlistApi.create({
      name,
      description: createForm.value.description,
      auto_fill_enabled: createForm.value.auto_fill_enabled
    })
    createVisible.value = false
    ElMessage.success('片单已创建')
    await fetchWatchlists()
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '创建失败')
  } finally {
    saving.value = false
  }
}

const loadDetail = async (watchlistId) => {
  detailLoading.value = true
  try {
    const { data } = await watchlistApi.get(watchlistId)
    activeWatchlist.value = data
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载片单详情失败')
  } finally {
    detailLoading.value = false
  }
}

const openDetail = async (list) => {
  activeWatchlist.value = list
  detailVisible.value = true
  await loadDetail(list.id)
}

const handleFill = async () => {
  if (!activeWatchlist.value?.id) return
  filling.value = true
  try {
    const { data } = await watchlistApi.fill(activeWatchlist.value.id)
    ElMessage.success(data.message || '补缺完成')
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '补缺失败')
  } finally {
    filling.value = false
  }
}

const handleDeleteWatchlist = async () => {
  if (!activeWatchlist.value?.id) return
  try {
    await ElMessageBox.confirm(`确定删除片单「${activeWatchlist.value.name}」吗？`, '删除片单', {
      type: 'warning'
    })
    await watchlistApi.delete(activeWatchlist.value.id)
    detailVisible.value = false
    activeWatchlist.value = null
    ElMessage.success('片单已删除')
    await fetchWatchlists()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.detail || '删除失败')
    }
  }
}

const handleRemoveItem = async (item) => {
  if (!activeWatchlist.value?.id) return
  try {
    await watchlistApi.removeItem(activeWatchlist.value.id, item.id)
    ElMessage.success('已移除')
    await loadDetail(activeWatchlist.value.id)
    await fetchWatchlists()
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '移除失败')
  }
}

const goToDetail = (item) => {
  const path = item.media_type === 'tv' ? `/tv/${item.tmdb_id}` : `/movie/${item.tmdb_id}`
  router.push({ path, query: { from: '/watchlists' } })
}

onMounted(async () => {
  await Promise.all([fetchWatchlists(), loadImportCatalog()])
})
</script>

<style scoped lang="scss">
.watchlists-page {
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;

    .header-actions {
      display: flex;
      gap: 8px;
    }
  }

  .import-tabs {
    margin-bottom: 12px;
  }

  .category-desc {
    display: block;
    margin-bottom: 12px;
    line-height: 1.5;
  }

  .source-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
    margin-bottom: 8px;
  }

  .source-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--ms-surface-muted, var(--el-fill-color-blank));
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:hover {
      border-color: var(--el-color-primary-light-5);
    }

    &.active {
      border-color: var(--el-color-primary);
      box-shadow: 0 0 0 1px var(--el-color-primary);
    }

    .source-card-label {
      font-weight: 600;
      font-size: 14px;
      color: var(--ms-text-primary, var(--el-text-color-primary));
    }

    .source-card-desc {
      font-size: 12px;
      line-height: 1.4;
      color: var(--ms-text-muted, var(--el-text-color-secondary));
    }
  }

  .preview-alert {
    margin-bottom: 12px;

    .preview-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .preview-desc {
      margin-bottom: 6px;
      color: var(--ms-text-secondary);
    }

    .preview-meta {
      font-size: 13px;
    }
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 10px;
    margin-bottom: 8px;
  }

  .preview-card {
    img {
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      border-radius: 6px;
      display: block;
      background: var(--ms-surface-muted);
    }

    .poster-placeholder {
      aspect-ratio: 2 / 3;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      background: var(--ms-surface-muted);
      color: var(--ms-text-muted);
      font-size: 11px;
    }

    .preview-card-title {
      display: block;
      margin-top: 4px;
      font-size: 11px;
      line-height: 1.3;
      color: var(--ms-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .watchlist-card {
    margin-bottom: 16px;
    cursor: pointer;

    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .card-desc {
      color: var(--ms-text-muted);
      font-size: 13px;
      min-height: 40px;
      margin-bottom: 12px;
    }

    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--ms-text-muted);
      font-size: 12px;
    }
  }

  .detail-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .items-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }

  .item-card {
    .item-poster {
      aspect-ratio: 2 / 3;
      overflow: hidden;
      border-radius: 8px;
      cursor: pointer;
      background: var(--ms-surface-muted);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .poster-placeholder {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ms-text-muted);
      font-size: 12px;
    }

    .item-info {
      margin-top: 10px;

      .item-title {
        font-weight: 600;
        margin-bottom: 6px;
        cursor: pointer;
      }

      .item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        color: var(--ms-text-muted);
        font-size: 12px;
      }
    }
  }
}
</style>
