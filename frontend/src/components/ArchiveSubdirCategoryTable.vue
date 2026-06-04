<template>
  <div class="subdir-category-table">
    <div class="subdir-toolbar">
      <el-button size="small" @click="handleAdd">添加分类</el-button>
    </div>

    <el-table :data="categories" size="small" border>
      <el-table-column label="文件夹名称" min-width="160">
        <template #default="{ row }">
          <el-input v-model="row.name" maxlength="64" :disabled="!row.enabled" />
        </template>
      </el-table-column>

      <el-table-column label="匹配方式" width="180">
        <template #default="{ row }">
          <el-select
            v-model="row.match_type"
            :disabled="!row.enabled || !!row.is_fallback"
            style="width: 100%"
            @change="(value) => handleMatchTypeChange(row, value)"
          >
            <el-option
              v-for="opt in matchTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
              :disabled="opt.value === 'fallback' && hasFallback && !row.is_fallback"
            />
          </el-select>
        </template>
      </el-table-column>

      <el-table-column label="匹配条件" min-width="320">
        <template #default="{ row }">
          <div v-if="row.match_type === 'fallback'" class="match-condition-cell">
            <el-tag type="info" effect="plain">未匹配到其他分类时归入此目录</el-tag>
          </div>
          <div v-else-if="row.match_type === 'genre'" class="match-condition-cell">
            <el-select
              v-model="row.match_genre_ids"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :disabled="!row.enabled"
              placeholder="选择 TMDB 剧集类型"
              style="width: 100%"
            >
              <el-option
                v-for="genre in tvGenres"
                :key="genre.id"
                :label="`${genre.name}（ID ${genre.id}）`"
                :value="genre.id"
              />
            </el-select>
          </div>
          <div v-else class="match-condition-cell">
            <el-select
              v-model="row.match_countries"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :disabled="!row.enabled"
              placeholder="选择国家/地区"
              style="width: 100%"
            >
              <el-option-group
                v-for="group in countryGroups"
                :key="group.label"
                :label="group.label"
              >
                <el-option
                  v-for="country in group.countries"
                  :key="country.code"
                  :label="`${country.name}（${country.code}）`"
                  :value="country.code"
                />
              </el-option-group>
            </el-select>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="启用" width="72" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" :disabled="!!row.is_fallback" />
        </template>
      </el-table-column>

      <el-table-column label="操作" width="80" align="center">
        <template #default="{ row, $index }">
          <el-button
            v-if="!row.is_fallback"
            type="danger"
            text
            size="small"
            @click="handleRemove($index)"
          >删除</el-button>
          <span v-else class="muted-text">兜底</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { applySubdirMatchTypeChange, createSubdirCategoryRow } from '@/utils/archiveSubdirs'

const props = defineProps({
  mediaType: {
    type: String,
    required: true,
    validator: (value) => ['movie', 'tv'].includes(value)
  },
  categories: {
    type: Array,
    required: true
  },
  countryGroups: {
    type: Array,
    default: () => []
  },
  tvGenres: {
    type: Array,
    default: () => []
  },
  matchTypeOptions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['add', 'remove'])

const hasFallback = computed(() =>
  (props.categories || []).some((row) => row.match_type === 'fallback' || row.is_fallback)
)

const handleMatchTypeChange = (row, matchType) => {
  applySubdirMatchTypeChange(row, matchType, props.mediaType)
}

const handleAdd = () => {
  const nextIndex = (props.categories?.length || 0) + 1
  emit('add', createSubdirCategoryRow(props.mediaType, nextIndex))
}

const handleRemove = (index) => {
  emit('remove', index)
}
</script>

<style scoped lang="scss">
.subdir-category-table {
  .subdir-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .match-condition-cell {
    width: 100%;
  }

  .muted-text {
    color: var(--ms-text-secondary);
    font-size: 12px;
  }
}
</style>
