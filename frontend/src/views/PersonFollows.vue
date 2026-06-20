<template>
  <div class="person-follows-page">
    <div class="page-header">
      <h2>演职员关注</h2>
      <div class="header-actions">
        <el-button type="primary" :loading="syncing" @click="handleSync">立即同步</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="关注列表" name="follows">
        <div class="follows-grid" v-loading="loading">
          <el-card
            v-for="person in follows"
            :key="person.id"
            class="follow-card"
            shadow="hover"
            :body-style="{ padding: '16px' }"
            @click="goToPerson(person)"
          >
            <div class="card-layout">
              <div class="avatar-wrap">
                <img
                  v-if="hasProfile(person)"
                  :src="getProfileUrl(person.profile_path)"
                  :alt="person.name"
                  loading="lazy"
                  decoding="async"
                  @error="handleAvatarError($event, person)"
                />
                <div v-else class="avatar-placeholder">{{ person.name?.slice(0, 1) || '?' }}</div>
              </div>

              <div class="card-main">
                <div class="name-row">
                  <h3 class="name">{{ person.name }}</h3>
                  <el-tag size="small" type="info">{{ getDepartmentLabel(person.known_for_department) }}</el-tag>
                </div>

                <div class="card-actions" @click.stop>
                  <el-switch
                    v-model="person.auto_subscribe_new_works"
                    size="small"
                    inline-prompt
                    active-text="自动订阅"
                    inactive-text="仅关注"
                    @change="(value) => handleToggleAutoSubscribe(person, value)"
                  />
                  <el-button size="small" type="danger" plain @click="handleUnfollow(person)">
                    取消关注
                  </el-button>
                </div>
              </div>
            </div>
          </el-card>
          <el-empty v-if="!loading && follows.length === 0" description="还没有关注的演职员" />
        </div>
      </el-tab-pane>

      <el-tab-pane label="新作动态" name="feed">
        <el-text type="info" class="feed-hint">仅显示上映/首播日期晚于今天的作品</el-text>
        <div v-loading="feedLoading">
          <div v-if="feed.length > 0" class="feed-grid">
            <article
              v-for="item in feed"
              :key="item.id"
              class="feed-card"
              @click="goToWork(item)"
            >
              <div class="feed-poster">
                <img
                  v-if="item.poster_path"
                  :src="getPosterUrl(item.poster_path)"
                  :alt="item.title"
                  loading="lazy"
                  decoding="async"
                />
                <div v-else class="poster-placeholder">暂无海报</div>
                <LibraryBadge
                  v-if="item.isInMediaLibrary"
                  class="library-badge"
                  :in-emby="item.isInEmby"
                  :in-feiniu="item.isInFeiniu"
                />
                <el-tag
                  class="type-tag"
                  size="small"
                  :type="item.media_type === 'movie' ? 'primary' : 'success'"
                >
                  {{ item.media_type === 'movie' ? '电影' : '电视剧' }}
                </el-tag>
                <div class="feed-card-actions" @click.stop>
                  <el-button
                    class="feed-action-btn"
                    :type="item.isSubscribed ? 'success' : 'primary'"
                    circle
                    :title="item.isSubscribed ? '取消订阅' : '订阅'"
                    :loading="item.subscribing"
                    @click="handleSubscribe(item)"
                  >
                    <el-icon><Star /></el-icon>
                  </el-button>
                  <el-button
                    class="feed-action-btn"
                    type="warning"
                    circle
                    title="转存"
                    :loading="item.saving"
                    @click="handleSave(item)"
                  >
                    <el-icon><FolderAdd /></el-icon>
                  </el-button>
                </div>
              </div>
              <div class="feed-body">
                <div class="feed-person" @click.stop="goToPersonByFeed(item)">
                  <img
                    v-if="item.person_profile_path"
                    class="feed-avatar"
                    :src="getProfileUrl(item.person_profile_path)"
                    :alt="item.person_name"
                  />
                  <span class="person">{{ item.person_name }}</span>
                </div>
                <h4 class="feed-title">{{ item.title }}</h4>
                <p class="feed-date">{{ formatCreditDate(item.credit_date) }}</p>
              </div>
            </article>
          </div>
          <el-empty v-else description="暂无新作动态" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Star, FolderAdd } from '@element-plus/icons-vue'
import { personFollowApi } from '@/api'
import LibraryBadge from '@/components/media/LibraryBadge.vue'
import { useMediaCardActions } from '@/composables/useMediaCardActions'
import { getDepartmentLabel, getTmdbProfileUrl } from '@/utils/tmdbProfile'
import { formatBeijingDateTime } from '@/utils/timezone'

const router = useRouter()
const activeTab = ref('follows')
const loading = ref(false)
const feedLoading = ref(false)
const syncing = ref(false)
const follows = ref([])
const feed = ref([])
const brokenAvatars = ref(new Set())
const {
  refreshSubscribedMap,
  applySubscribedFlags,
  syncItemStates,
  fetchQueueActiveTasks,
  handleSubscribe,
  handleSave
} = useMediaCardActions({
  source: 'tmdb',
  getItems: () => feed.value
})

const hasProfile = (person) => {
  const key = String(person?.id || person?.tmdb_person_id || '')
  return Boolean(String(person?.profile_path || '').trim()) && !brokenAvatars.value.has(key)
}

const getProfileUrl = (path) => getTmdbProfileUrl(path)
const getPosterUrl = (path) => getTmdbProfileUrl(path, 'w342')

const handleAvatarError = (event, person) => {
  const key = String(person?.id || person?.tmdb_person_id || '')
  if (key) brokenAvatars.value.add(key)
  if (event?.target) event.target.style.display = 'none'
}

const formatCreditDate = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return '日期待定'
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return formatBeijingDateTime(value)
}

const fetchFollows = async () => {
  loading.value = true
  brokenAvatars.value = new Set()
  try {
    const { data } = await personFollowApi.list()
    follows.value = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载关注列表失败')
  } finally {
    loading.value = false
  }
}

const fetchFeed = async () => {
  feedLoading.value = true
  try {
    const { data } = await personFollowApi.getFeed(50)
    feed.value = Array.isArray(data) ? data : []
    await refreshSubscribedMap()
    await fetchQueueActiveTasks()
    syncItemStates(feed.value)
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载动态失败')
  } finally {
    feedLoading.value = false
  }
}

const handleSync = async () => {
  syncing.value = true
  try {
    const { data } = await personFollowApi.sync()
    ElMessage.success(data.message || '同步完成')
    await Promise.all([fetchFollows(), fetchFeed()])
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '同步失败')
  } finally {
    syncing.value = false
  }
}

const handleToggleAutoSubscribe = async (person, value) => {
  try {
    await personFollowApi.update(person.id, { auto_subscribe_new_works: value })
    ElMessage.success('设置已更新')
  } catch (error) {
    person.auto_subscribe_new_works = !value
    ElMessage.error(error.response?.data?.detail || '更新失败')
  }
}

const handleUnfollow = async (person) => {
  try {
    await personFollowApi.delete(person.id)
    ElMessage.success('已取消关注')
    await fetchFollows()
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '取消关注失败')
  }
}

const goToPerson = (person) => {
  router.push({ path: `/person/${person.tmdb_person_id}`, query: { from: '/person-follows' } })
}

const goToPersonByFeed = (item) => {
  const personId = Number(item?.person_tmdb_id || item?.tmdb_person_id || 0)
  if (!personId) return
  router.push({ path: `/person/${personId}`, query: { from: '/person-follows' } })
}

const goToWork = (item) => {
  const path = item.media_type === 'tv' ? `/tv/${item.tmdb_id}` : `/movie/${item.tmdb_id}`
  router.push({ path, query: { from: '/person-follows' } })
}

watch(activeTab, (tab) => {
  if (tab === 'feed' && feed.value.length === 0) {
    fetchFeed()
  }
})

onMounted(async () => {
  await fetchFollows()
})
</script>

<style scoped lang="scss">
.person-follows-page {
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .follows-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }

  .follow-card {
    cursor: pointer;

    .card-layout {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .avatar-wrap {
      width: 72px;
      height: 72px;
      border-radius: 12px;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--ms-surface-muted);
      border: 1px solid var(--ms-border-subtle, rgba(255, 255, 255, 0.08));

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }

    .avatar-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 600;
      color: var(--ms-text-muted);
      background: var(--ms-surface-muted);
    }

    .card-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .name-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;

      .name {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--ms-text-primary);
      }
    }

    .card-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
  }

  .feed-hint {
    display: block;
    margin-bottom: 12px;
    font-size: 13px;
  }

  .feed-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }

  .feed-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-radius: 12px;
    border: 1px solid var(--ms-border-color, rgba(255, 255, 255, 0.08));
    background: var(--ms-glass-bg, rgba(255, 255, 255, 0.03));
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      transform: translateY(-3px);
      box-shadow: var(--ms-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.18));
    }

    .feed-poster {
      position: relative;
      aspect-ratio: 2 / 3;
      background: var(--ms-surface-muted);

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .type-tag {
        position: absolute;
        top: 8px;
        left: 8px;
      }

      .library-badge {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 4;
      }

      .poster-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--ms-text-muted);
        font-size: 12px;
      }

      .feed-card-actions {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translate(-50%, 10px);
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 3;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.22s ease, transform 0.22s ease;

        .feed-action-btn {
          margin: 0;
          width: 34px;
          height: 34px;
          padding: 0;
          pointer-events: auto;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.36);
        }
      }

      &:hover .feed-card-actions,
      &:focus-within .feed-card-actions {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }

    .feed-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px 12px;
      min-width: 0;
    }

    .feed-person {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--ms-text-secondary);
      font-size: 12px;

      .feed-avatar {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        object-fit: cover;
      }

      .person {
        font-weight: 600;
      }
    }

    .feed-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .feed-date {
      margin: 0;
      font-size: 12px;
      color: var(--ms-text-muted);
    }
  }

  @media (max-width: 768px) {
    .follows-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
