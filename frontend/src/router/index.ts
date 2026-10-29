import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/store/user'

declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题，同时用于浏览器标题与顶栏 */
    title?: string
    /** 是否免登录 */
    public?: boolean
    /** 模块负责人，便于对照分工 */
    owner?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/BasicLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '工作台' }
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '项目管理', owner: 'B' }
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '任务看板', owner: 'B' }
      },
      {
        path: 'literatures',
        name: 'literatures',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '文献管理', owner: 'C' }
      },
      {
        path: 'meetings',
        name: 'meetings',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '会议管理', owner: 'C' }
      },
      {
        path: 'achievements',
        name: 'achievements',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '成果管理', owner: 'C' }
      },
      {
        path: 'contribution',
        name: 'contribution',
        component: () => import('@/views/PlaceholderView.vue'),
        meta: { title: '参与度分析', owner: 'D' }
      },
      {
        path: 'members',
        name: 'members',
        component: () => import('@/views/MembersView.vue'),
        meta: { title: '课题组成员', owner: 'A' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在', public: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach((to) => {
  const userStore = useUserStore()
  if (to.meta.public) return true
  if (!userStore.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  const base = import.meta.env.VITE_APP_TITLE || '校园科研项目协作与成果管理平台'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})

export default router
