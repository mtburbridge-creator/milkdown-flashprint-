import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import 'katex/dist/katex.min.css'
import './core/print.css'
import './app/app.css'
import { createApp } from 'vue'

import { App } from './app/app'

createApp(App).mount('#app')
