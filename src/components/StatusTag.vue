<script setup lang="ts">
import { computed } from 'vue'
import { getStatusLabel, getStatusType } from '@/constants/task'

const props = defineProps<{ status?: string | null }>()

const label = computed(() => getStatusLabel(props.status))
const type = computed(() => getStatusType(props.status))
</script>

<template>
  <el-tag :type="type" size="small" effect="light" disable-transitions>{{ label }}</el-tag>
</template>
