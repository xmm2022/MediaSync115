<template>
  <div class="person-detail-page" v-loading="loading">
    <template v-if="person">
      <div class="back-button-container">
        <el-button text @click="handleBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
      </div>

      <section class="detail-header">
        <div class="avatar">
          <img v-if="person.profile_path" :src="getProfileUrl(person.profile_path)" :alt="person.name" />
          <div v-else class="avatar-placeholder">{{ person.name?.slice(0, 1) || '?' }}</div>
        </div>
        <div class="info">
          <h1 class="person-name">{{ person.name }}</h1>
          <div class="meta">
            <el-tag v-if="person.known_for_department" size="small" type="info">
              {{ getDepartmentLabel(person.known_for_department) }}
            </el-tag>
            <span v-if="person.birthday">生于 {{ person.birthday }}</span>
            <span v-if="person.place_of_birth">{{ person.place_of_birth }}</span>
          </div>
          <p v-if="person.biography" class="biography">{{ person.biography }}</p>
          <div class="follow-action">
            <el-button
              :type="isFollowed ? 'success' : 'primary'"
              :loading="toggling"
              @click="handleToggleFollow"
            >
              {{ isFollowed ? '已关注（点击取消）' : '关注演职员' }}
            </el-button>
          </div>
        </div>
      </section>

      <section class="credits-section">
        <div class="section-head">
          <h3>作品列表</h3>
          <span v-if="credits.length" class="section-count">共 {{ credits.length }} 部</span>
        </div>

        <div v-if="credits.length" class="credits-grid">
          <article
            v-for="credit in credits"
            :key="`${credit.media_type}-${credit.tmdb_id}`"
            class="credit-card"
            @click="goToWork(credit)"
          >
            <div class="poster-wrap">
              <img
                v-if="credit.poster_path"
                :src="getPosterUrl(credit.poster_path)"
                :alt="credit.title"
                loading="lazy"
                decoding="async"
              />
              <div v-else class="poster-placeholder">暂无海报</div>
              <LibraryBadge
                v-if="credit.isInMediaLibrary"
                class="library-badge"
                :in-emby="credit.isInEmby"
                :in-feiniu="credit.isInFeiniu"
              />
              <el-tag
                class="type-tag"
                size="small"
                :type="credit.media_type === 'movie' ? 'primary' : 'success'"
              >
                {{ credit.media_type === 'movie' ? '电影' : '电视剧' }}
              </el-tag>
              <div class="credit-card-actions" @click.stop>
                <el-button
                  class="credit-action-btn"
                  :type="credit.isSubscribed ? 'success' : 'primary'"
                  circle
                  :title="credit.isSubscribed ? '取消订阅' : '订阅'"
                  :loading="credit.subscribing"
                  @click="handleSubscribe(credit)"
                >
                  <el-icon><Star /></el-icon>
                </el-button>
                <el-button
                  class="credit-action-btn"
                  type="warning"
                  circle
                  title="转存"
                  :loading="credit.saving"
                  @click="handleSave(credit)"
                >
                  <el-icon><FolderAdd /></el-icon>
                </el-button>
              </div>
            </div>
            <div class="credit-body">
              <h4 class="credit-title" :title="credit.title">{{ credit.title }}</h4>
              <p class="credit-date">{{ formatCreditDate(credit) }}</p>
              <p v-if="credit.character || credit.job" class="credit-role">
                {{ credit.character || credit.job }}
              </p>
            </div>
          </article>
        </div>
        <el-empty v-else description="暂无作品" />
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Star, FolderAdd } from '@element-plus/icons-vue'
import { personFollowApi, searchApi } from '@/api'
import LibraryBadge from '@/components/media/LibraryBadge.vue'
import { useMediaCardActions } from '@/composables/useMediaCardActions'
import { getDepartmentLabel, getTmdbProfileUrl } from '@/utils/tmdbProfile'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const toggling = ref(false)
const person = ref(null)
const followedPersonIds = ref(new Set())
const {
  refreshSubscribedMap,
  applySubscribedFlags,
  syncItemStates,
  fetchQueueActiveTasks,
  handleSubscribe,
  handleSave
} = useMediaCardActions({
  source: 'tmdb',
  getItems: () => credits.value
})

const personId = computed(() => Number(route.params.id || 0))
const isFollowed = computed(() => followedPersonIds.value.has(String(personId.value)))
const credits = computed(() => {
  const rows = person.value?.credits
  return Array.isArray(rows) ? rows : []
})

const getProfileUrl = (path) => getTmdbProfileUrl(path)
const getPosterUrl = (path) => getTmdbProfileUrl(path, 'w342')

const formatCreditDate = (credit) => {
  const raw = String(credit?.release_date || credit?.first_air_date || '').trim()
  if (!raw) return '日期待定'
  return raw.length >= 4 ? raw.slice(0, 4) : raw
}

const refreshFollowStatus = async () => {
  try {
    const { data } = await personFollowApi.getStatusMap()
    const map = data?.person_id_map || {}
    followedPersonIds.value = new Set(Object.keys(map))
  } catch {
    followedPersonIds.value = new Set()
  }
}

const fetchPerson = async () => {
  if (!personId.value) return
  loading.value = true
  try {
    const { data } = await searchApi.getPerson(personId.value)
    person.value = data
    await refreshSubscribedMap()
    await fetchQueueActiveTasks()
    syncItemStates(person.value?.credits)
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载演职员详情失败')
  } finally {
    loading.value = false
  }
}

watch(credits, (rows) => {
  syncItemStates(rows)
})

const handleToggleFollow = async () => {
  if (!person.value) return
  toggling.value = true
  try {
    const { data } = await personFollowApi.toggle({
      tmdb_person_id: person.value.tmdb_person_id || personId.value,
      name: person.value.name,
      profile_path: person.value.profile_path,
      known_for_department: person.value.known_for_department
    })
    if (data.followed) {
      followedPersonIds.value.add(String(personId.value))
      ElMessage.success('已关注')
    } else {
      followedPersonIds.value.delete(String(personId.value))
      ElMessage.success('已取消关注')
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '操作失败')
  } finally {
    toggling.value = false
  }
}

const goToWork = (credit) => {
  const path = credit.media_type === 'tv' ? `/tv/${credit.tmdb_id}` : `/movie/${credit.tmdb_id}`
  router.push({ path, query: { from: route.fullPath } })
}

const handleBack = () => {
  const from = String(route.query.from || '').trim()
  router.push(from || '/person-follows')
}

onMounted(async () => {
  await Promise.all([fetchPerson(), refreshFollowStatus()])
})
</script>

<style scoped lang="scss">
.person-detail-page {
  .back-button-container {
    margin-bottom: 12px;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 28px;
    padding: 20px;
    border-radius: 16px;
    border: 1px solid var(--ms-border-color, rgba(255, 255, 255, 0.08));
    background: var(--ms-glass-bg, rgba(255, 255, 255, 0.03));

    .avatar {
      width: 160px;
      height: 160px;
      border-radius: 16px;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--ms-surface-muted);

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
      font-size: 48px;
      color: var(--ms-text-muted);
    }

    .info {
      flex: 1;
      min-width: 0;

      .person-name {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.25;
        word-break: break-word;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 14px;
        color: var(--ms-text-muted);
        font-size: 13px;
        margin-bottom: 14px;
      }

      .biography {
        margin: 0 0 16px;
        color: var(--ms-text-secondary);
        line-height: 1.7;
        font-size: 14px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .follow-action {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
    }
  }

  .credits-section {
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;

      h3 {
        margin: 0;
        font-size: 18px;
      }

      .section-count {
        color: var(--ms-text-muted);
        font-size: 13px;
      }
    }
  }

  .credits-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }

  .credit-card {
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

    .poster-wrap {
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

      .credit-card-actions {
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

        .credit-action-btn {
          margin: 0;
          width: 34px;
          height: 34px;
          padding: 0;
          pointer-events: auto;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.36);
        }
      }

      &:hover .credit-card-actions,
      &:focus-within .credit-card-actions {
        opacity: 1;
        transform: translate(-50%, 0);
      }
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

    .credit-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px 12px;
      min-width: 0;
    }

    .credit-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.35;
      color: var(--ms-text-primary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .credit-date {
      margin: 0;
      font-size: 12px;
      color: var(--ms-text-muted);
    }

    .credit-role {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: var(--ms-text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }
  }

  @media (max-width: 768px) {
    .detail-header {
      flex-direction: column;
      align-items: center;
      text-align: center;

      .info {
        width: 100%;

        .meta,
        .follow-action {
          justify-content: center;
        }
      }
    }

    .credits-grid {
      grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
      gap: 12px;
    }
  }
}
</style>
