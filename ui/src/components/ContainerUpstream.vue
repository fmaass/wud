<template>
  <v-list density="compact">
    <v-list-item>
      <template v-slot:prepend>
        <v-icon color="purple">mdi-github</v-icon>
      </template>
      <v-list-item-title>Repository</v-list-item-title>
      <v-list-item-subtitle>
        <a :href="repoUrl" target="_blank">{{ upstream.repo }}</a>
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="upstream.currentVersion">
      <template v-slot:prepend>
        <v-icon color="secondary">mdi-source-branch</v-icon>
      </template>
      <v-list-item-title>Your version</v-list-item-title>
      <v-list-item-subtitle>{{ upstream.currentVersion }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="upstream.latestVersion">
      <template v-slot:prepend>
        <v-icon :color="upstreamUpdateAvailable ? 'purple' : 'success'">mdi-tag</v-icon>
      </template>
      <v-list-item-title>Latest upstream release</v-list-item-title>
      <v-list-item-subtitle>
        <a v-if="upstream.latestUrl" :href="upstream.latestUrl" target="_blank">
          {{ upstream.latestVersion }}
        </a>
        <span v-else>{{ upstream.latestVersion }}</span>
        <v-chip
          v-if="upstreamUpdateAvailable"
          size="x-small"
          color="purple"
          variant="flat"
          class="ml-2"
        >
          update available
        </v-chip>
        <v-chip
          v-else-if="upstream.currentVersion"
          size="x-small"
          color="success"
          variant="flat"
          class="ml-2"
        >
          up to date
        </v-chip>
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="upstream.checkedAt">
      <template v-slot:prepend>
        <v-icon color="secondary">mdi-clock-outline</v-icon>
      </template>
      <v-list-item-title>Last checked</v-list-item-title>
      <v-list-item-subtitle>{{ formatDate(upstream.checkedAt) }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="upstream.error">
      <template v-slot:prepend>
        <v-icon color="warning">mdi-alert</v-icon>
      </template>
      <v-list-item-title>Error</v-list-item-title>
      <v-list-item-subtitle>{{ upstream.error }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="upstream.prerelease">
      <template v-slot:prepend>
        <v-icon color="secondary">mdi-flask</v-icon>
      </template>
      <v-list-item-title>Pre-releases</v-list-item-title>
      <v-list-item-subtitle>Included</v-list-item-subtitle>
    </v-list-item>
  </v-list>
</template>

<script>
export default {
  props: {
    upstream: {
      type: Object,
      required: true,
    },
    upstreamUpdateAvailable: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    repoUrl() {
      return `https://github.com/${this.upstream.repo}`;
    },
  },
  methods: {
    formatDate(isoString) {
      if (!isoString) return "";
      const date = new Date(isoString);
      return date.toLocaleString();
    },
  },
};
</script>
