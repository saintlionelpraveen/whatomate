<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import draggable from 'vuedraggable'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Plus,
  Trash2,
  GripVertical,
  Type,
  TextCursorInput,
  CircleDot,
  CheckSquare,
  Calendar,
  ChevronDown,
  Image,
  ArrowRight,
  Settings2,
  Layers,
  GitBranch
} from 'lucide-vue-next'

// Component types available in WhatsApp Flows
const componentTypes = [
  { type: 'TextHeading', label: 'Heading', icon: Type },
  { type: 'TextSubheading', label: 'Subheading', icon: Type },
  { type: 'TextBody', label: 'Text', icon: Type },
  { type: 'TextInput', label: 'Text Input', icon: TextCursorInput },
  { type: 'TextArea', label: 'Text Area', icon: TextCursorInput },
  { type: 'Dropdown', label: 'Dropdown', icon: ChevronDown },
  { type: 'RadioButtonsGroup', label: 'Radio Buttons', icon: CircleDot },
  { type: 'CheckboxGroup', label: 'Checkboxes', icon: CheckSquare },
  { type: 'DatePicker', label: 'Date Picker', icon: Calendar },
  { type: 'Image', label: 'Image', icon: Image },
  { type: 'Footer', label: 'Footer Button', icon: ArrowRight },
  { type: 'ConditionalRouter', label: 'If Condition', icon: GitBranch },
]

interface FlowComponent {
  id: string
  type: string
  name?: string
  label?: string
  text?: string
  required?: boolean
  'data-source'?: any[]
  'on-click-action'?: any
  [key: string]: any
}

interface FlowScreen {
  id: string
  title: string
  data: Record<string, any>
  layout: {
    type: string
    children: FlowComponent[]
  }
}

interface Props {
  modelValue?: { screens: FlowScreen[] }
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({ screens: [] })
})

const emit = defineEmits<{
  'update:modelValue': [value: { screens: FlowScreen[] }]
}>()

const screens = ref<FlowScreen[]>(props.modelValue?.screens || [])
const selectedScreenIndex = ref<number>(0)
const selectedComponentIndex = ref<number | null>(null)

// Watch for external changes
watch(() => props.modelValue, (newVal) => {
  if (newVal?.screens) {
    screens.value = newVal.screens
  }
}, { deep: true })

// Emit changes
watch(screens, (newScreens) => {
  emit('update:modelValue', { screens: newScreens })
}, { deep: true })

const selectedScreen = computed(() => screens.value[selectedScreenIndex.value])
const selectedComponent = computed(() => {
  if (selectedComponentIndex.value === null || !selectedScreen.value) return null
  return selectedScreen.value.layout.children[selectedComponentIndex.value]
})

// Available named fields on the current screen for routing
const availableFields = computed(() => {
  if (!selectedScreen.value) return []
  return selectedScreen.value.layout.children
    .filter((c: FlowComponent) => c.name && ['TextInput', 'TextArea', 'Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'DatePicker'].includes(c.type))
    .map((c: FlowComponent) => ({ name: c.name!, label: c.label || c.name!, type: c.type, dataSource: c['data-source'] }))
})

// Options for the selected routing field (if it has data-source like Dropdown/Radio)
const routingFieldOptions = computed(() => {
  if (!selectedComponent.value || selectedComponent.value.type !== 'ConditionalRouter') return []
  const fieldName = selectedComponent.value['routing-field']
  if (!fieldName) return []
  const field = availableFields.value.find((f: any) => f.name === fieldName)
  if (!field || !field.dataSource) return []
  return field.dataSource
})

// Generate a unique ID using only alphabets and underscores (Meta requirement)
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  let result = 'id_'
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate a user-friendly field name based on component type
function generateFieldName(type: string): string {
  // Count existing fields of this type across all screens
  let count = 1
  const prefix = type === 'TextInput' ? 'text_input' :
                 type === 'TextArea' ? 'text_area' :
                 type === 'Dropdown' ? 'dropdown' :
                 type === 'RadioButtonsGroup' ? 'radio' :
                 type === 'CheckboxGroup' ? 'checkbox' :
                 type === 'DatePicker' ? 'date' : 'field'

  for (const screen of screens.value) {
    for (const comp of screen.layout.children) {
      if (comp.name?.startsWith(prefix)) {
        count++
      }
    }
  }

  return `${prefix}_${count}`
}

// Convert number to letter sequence (1=A, 2=B, ..., 27=AA, etc.)
function numberToLetters(num: number): string {
  let result = ''
  while (num > 0) {
    num--
    result = String.fromCharCode(65 + (num % 26)) + result
    num = Math.floor(num / 26)
  }
  return result
}

function addScreen() {
  const screenNum = screens.value.length + 1
  screens.value.push({
    id: `SCREEN_${numberToLetters(screenNum)}`,
    title: `Screen ${screenNum}`,
    data: {},
    layout: {
      type: 'SingleColumnLayout',
      children: []
    }
  })
  selectedScreenIndex.value = screens.value.length - 1
  selectedComponentIndex.value = null
}

function removeScreen(index: number) {
  screens.value.splice(index, 1)
  if (selectedScreenIndex.value >= screens.value.length) {
    selectedScreenIndex.value = Math.max(0, screens.value.length - 1)
  }
  selectedComponentIndex.value = null
}

function selectScreen(index: number) {
  selectedScreenIndex.value = index
  selectedComponentIndex.value = null
}

function addComponent(type: string) {
  if (!selectedScreen.value) return

  const component: FlowComponent = {
    id: generateId(),
    type
  }

  // Set default properties based on type
  switch (type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
      component.text = 'Enter text here'
      break
    case 'TextInput':
      component.name = generateFieldName(type)
      component.label = 'Label'
      component.required = false
      component['input-type'] = 'text'
      break
    case 'TextArea':
      component.name = generateFieldName(type)
      component.label = 'Label'
      component.required = false
      break
    case 'Dropdown':
      component.name = generateFieldName(type)
      component.label = 'Select an option'
      component.required = false
      component['data-source'] = [
        { id: 'option_a', title: 'Option 1' },
        { id: 'option_b', title: 'Option 2' }
      ]
      break
    case 'RadioButtonsGroup':
      component.name = generateFieldName(type)
      component.label = 'Choose one'
      component.required = false
      component['data-source'] = [
        { id: 'option_a', title: 'Option 1' },
        { id: 'option_b', title: 'Option 2' }
      ]
      break
    case 'CheckboxGroup':
      component.name = generateFieldName(type)
      component.label = 'Select options'
      component.required = false
      component['data-source'] = [
        { id: 'option_a', title: 'Option 1' },
        { id: 'option_b', title: 'Option 2' }
      ]
      break
    case 'DatePicker':
      component.name = generateFieldName(type)
      component.label = 'Select date'
      component.required = false
      break
    case 'Image':
      component.src = ''
      component['aspect-ratio'] = 1
      break
    case 'Footer':
      component.label = 'Continue'
      component['on-click-action'] = {
        name: 'complete',
        payload: {}
      }
      break
    case 'ConditionalRouter':
      component['routing-field'] = ''
      component.conditions = [
        { value: '', target_screen: '', label: 'Condition 1' }
      ]
      component['else-screen'] = ''
      break
  }

  selectedScreen.value.layout.children.push(component)
  selectedComponentIndex.value = selectedScreen.value.layout.children.length - 1
}

function removeComponent(index: number) {
  if (!selectedScreen.value) return
  selectedScreen.value.layout.children.splice(index, 1)
  selectedComponentIndex.value = null
}

function selectComponent(index: number) {
  selectedComponentIndex.value = index
}

function moveComponent(index: number, direction: 'up' | 'down') {
  if (!selectedScreen.value) return
  const children = selectedScreen.value.layout.children
  const newIndex = direction === 'up' ? index - 1 : index + 1

  if (newIndex < 0 || newIndex >= children.length) return

  const temp = children[index]
  children[index] = children[newIndex]
  children[newIndex] = temp

  selectedComponentIndex.value = newIndex
}

function updateComponentProperty(key: string, value: any) {
  if (selectedComponentIndex.value === null || !selectedScreen.value) return
  selectedScreen.value.layout.children[selectedComponentIndex.value][key] = value
}

function addOption() {
  if (!selectedComponent.value || !selectedComponent.value['data-source']) return
  selectedComponent.value['data-source'].push({
    id: generateId(),
    title: 'New Option'
  })
}

function removeOption(index: number) {
  if (!selectedComponent.value || !selectedComponent.value['data-source']) return
  selectedComponent.value['data-source'].splice(index, 1)
}

function updateOption(index: number, key: string, value: string) {
  if (!selectedComponent.value || !selectedComponent.value['data-source']) return
  selectedComponent.value['data-source'][index][key] = value
}

// --- Conditional Router helpers ---
function addCondition() {
  if (!selectedComponent.value || !selectedComponent.value.conditions) return
  selectedComponent.value.conditions.push({ value: '', target_screen: '', label: `Condition ${selectedComponent.value.conditions.length + 1}` })
}

function removeCondition(index: number) {
  if (!selectedComponent.value || !selectedComponent.value.conditions) return
  selectedComponent.value.conditions.splice(index, 1)
}

function updateCondition(index: number, key: string, value: string) {
  if (!selectedComponent.value || !selectedComponent.value.conditions) return
  selectedComponent.value.conditions[index][key] = value
}

function getScreenTitle(screenId: string): string {
  const s = screens.value.find(sc => sc.id === screenId)
  return s?.title || screenId || 'Not set'
}

function getComponentLabel(comp: FlowComponent): string {
  const typeInfo = componentTypes.find(t => t.type === comp.type)
  return typeInfo?.label || comp.type
}

function getComponentIcon(type: string) {
  return componentTypes.find(t => t.type === type)?.icon || Type
}

// Components that should NOT have an 'id' property when sent to Meta API
const componentsWithoutId = [
  'TextHeading',
  'TextSubheading',
  'TextBody',
  'TextInput',
  'TextArea',
  'Dropdown',
  'RadioButtonsGroup',
  'CheckboxGroup',
  'DatePicker',
  'Image',
  'Footer',
  'ConditionalRouter'
]

// Sanitize flow JSON for Meta API by removing 'id' from components that don't support it
function sanitizeFlowForMeta(flowData: { screens: FlowScreen[] }): { screens: any[] } {
  return {
    screens: flowData.screens.map(screen => {
      // Extract routing rules from ConditionalRouter components
      const routerComps = screen.layout.children.filter(c => c.type === 'ConditionalRouter')
      const routingRules = routerComps.map(rc => ({
        field: rc['routing-field'],
        conditions: rc.conditions || [],
        elseScreen: rc['else-screen'] || ''
      }))
      const screenData = { ...screen.data }
      if (routingRules.length > 0) {
        screenData.__routing_rules = routingRules
      }
      return {
        id: screen.id,
        title: screen.title,
        data: screenData,
        layout: {
          type: screen.layout.type,
          children: screen.layout.children
            .filter(comp => comp.type !== 'ConditionalRouter')
            .map(comp => {
              const { id, ...rest } = comp
              if (componentsWithoutId.includes(comp.type)) { return rest }
              return comp
            })
        }
      }
    })
  }
}

// Expose sanitize function for parent components
defineExpose({
  sanitizeFlowForMeta
})
</script>

<template>
  <div class="flex h-full gap-4">
    <!-- Screens Panel -->
    <Card class="w-64 flex-shrink-0 flex flex-col overflow-hidden">
      <CardHeader class="py-3 px-4">
        <div class="flex items-center justify-between">
          <CardTitle class="text-sm font-medium flex items-center gap-2">
            <Layers class="h-4 w-4" />
            Screens
          </CardTitle>
          <Button variant="ghost" size="icon" class="h-7 w-7" @click="addScreen">
            <Plus class="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <ScrollArea class="flex-1">
        <div class="p-2 space-y-1">
          <draggable
            v-model="screens"
            item-key="id"
            handle=".drag-handle"
            ghost-class="opacity-30"
            animation="200"
          >
            <template #item="{ element: screen, index }">
              <div
                :class="[
                  'flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm',
                  selectedScreenIndex === index ? 'bg-primary text-primary-foreground light:bg-primary light:text-primary-foreground' : 'hover:bg-muted'
                ]"
                @click="selectScreen(index)"
              >
                <GripVertical class="h-4 w-4 opacity-50 cursor-grab active:cursor-grabbing drag-handle" />
                <span class="flex-1 truncate">{{ screen.title }}</span>
                <Button
                  v-if="screens.length > 1"
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 opacity-50 hover:opacity-100"
                  @click.stop="removeScreen(index)"
                >
                  <Trash2 class="h-3 w-3" />
                </Button>
              </div>
            </template>
          </draggable>
          <div
            v-if="screens.length === 0"
            class="p-4 text-center text-sm text-muted-foreground"
          >
            No screens yet
          </div>
        </div>
      </ScrollArea>
    </Card>

    <!-- Screen Editor -->
    <Card class="flex-1 flex flex-col overflow-hidden">
      <CardHeader class="py-3 px-4 flex-shrink-0">
        <div class="flex items-center justify-between">
          <div v-if="selectedScreen" class="flex items-center gap-2">
            <Input
              v-model="selectedScreen.title"
              class="h-8 w-48 text-sm font-medium"
              placeholder="Screen Title"
            />
            <Badge variant="outline">{{ selectedScreen.id }}</Badge>
          </div>
          <CardTitle v-else class="text-sm font-medium">Select a screen</CardTitle>
        </div>
      </CardHeader>
      <Separator />

      <div v-if="selectedScreen" class="flex-1 flex overflow-hidden">
        <!-- Component Palette -->
        <ScrollArea class="w-48 border-r flex-shrink-0">
          <div class="p-3">
            <p class="text-xs font-medium text-muted-foreground mb-2">Add Components</p>
            <div class="grid grid-cols-2 gap-1">
              <Button
                v-for="comp in componentTypes"
                :key="comp.type"
                variant="outline"
                size="sm"
                class="h-auto py-2 flex-col gap-1 text-xs"
                @click="addComponent(comp.type)"
              >
                <component :is="comp.icon" class="h-4 w-4" />
                <span class="text-[10px]">{{ comp.label }}</span>
              </Button>
            </div>
          </div>
        </ScrollArea>

        <!-- Screen Preview -->
        <ScrollArea class="flex-1">
          <div class="p-4">
            <div class="max-w-sm mx-auto bg-muted/30 rounded-lg p-4">
            <h3 class="text-lg font-semibold mb-4">{{ selectedScreen.title }}</h3>
            <div class="space-y-3">
              <div
                v-for="(comp, index) in selectedScreen.layout.children"
                :key="comp.id"
                :class="[
                  'p-3 rounded-md border-2 cursor-pointer transition-colors',
                  selectedComponentIndex === index
                    ? 'border-primary bg-primary/5'
                    : 'border-transparent hover:border-muted-foreground/20'
                ]"
                @click="selectComponent(index)"
              >
                <!-- Text Components -->
                <template v-if="comp.type === 'TextHeading'">
                  <h2 class="text-xl font-bold">{{ comp.text }}</h2>
                </template>
                <template v-else-if="comp.type === 'TextSubheading'">
                  <h3 class="text-lg font-semibold">{{ comp.text }}</h3>
                </template>
                <template v-else-if="comp.type === 'TextBody'">
                  <p class="text-sm">{{ comp.text }}</p>
                </template>

                <!-- Input Components -->
                <template v-else-if="comp.type === 'TextInput' || comp.type === 'TextArea'">
                  <Label class="text-sm">
                    {{ comp.label }}
                    <span v-if="comp.required" class="text-destructive">*</span>
                  </Label>
                  <Input
                    v-if="comp.type === 'TextInput'"
                    disabled
                    :placeholder="comp.label"
                    class="mt-1"
                  />
                  <textarea
                    v-else
                    disabled
                    :placeholder="comp.label"
                    class="mt-1 w-full p-2 rounded-md border bg-background text-sm"
                    rows="3"
                  />
                </template>

                <!-- Dropdown -->
                <template v-else-if="comp.type === 'Dropdown'">
                  <Label class="text-sm">
                    {{ comp.label }}
                    <span v-if="comp.required" class="text-destructive">*</span>
                  </Label>
                  <div class="mt-1 p-2 rounded-md border bg-background text-sm flex items-center justify-between">
                    <span class="text-muted-foreground">Select...</span>
                    <ChevronDown class="h-4 w-4" />
                  </div>
                </template>

                <!-- Radio Buttons -->
                <template v-else-if="comp.type === 'RadioButtonsGroup'">
                  <Label class="text-sm mb-2 block">
                    {{ comp.label }}
                    <span v-if="comp.required" class="text-destructive">*</span>
                  </Label>
                  <div class="space-y-2">
                    <div
                      v-for="opt in comp['data-source']"
                      :key="opt.id"
                      class="flex items-center gap-2"
                    >
                      <div class="h-4 w-4 rounded-full border-2" />
                      <span class="text-sm">{{ opt.title }}</span>
                    </div>
                  </div>
                </template>

                <!-- Checkboxes -->
                <template v-else-if="comp.type === 'CheckboxGroup'">
                  <Label class="text-sm mb-2 block">
                    {{ comp.label }}
                    <span v-if="comp.required" class="text-destructive">*</span>
                  </Label>
                  <div class="space-y-2">
                    <div
                      v-for="opt in comp['data-source']"
                      :key="opt.id"
                      class="flex items-center gap-2"
                    >
                      <div class="h-4 w-4 rounded border" />
                      <span class="text-sm">{{ opt.title }}</span>
                    </div>
                  </div>
                </template>

                <!-- Date Picker -->
                <template v-else-if="comp.type === 'DatePicker'">
                  <Label class="text-sm">
                    {{ comp.label }}
                    <span v-if="comp.required" class="text-destructive">*</span>
                  </Label>
                  <div class="mt-1 p-2 rounded-md border bg-background text-sm flex items-center justify-between">
                    <span class="text-muted-foreground">Select date...</span>
                    <Calendar class="h-4 w-4" />
                  </div>
                </template>

                <!-- Image -->
                <template v-else-if="comp.type === 'Image'">
                  <div class="bg-muted rounded-md p-8 flex items-center justify-center">
                    <Image class="h-8 w-8 text-muted-foreground" />
                  </div>
                </template>

                <!-- Footer -->
                <template v-else-if="comp.type === 'Footer'">
                  <Button class="w-full">{{ comp.label }}</Button>
                </template>

                <!-- Conditional Router -->
                <template v-else-if="comp.type === 'ConditionalRouter'">
                  <div class="bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-lg p-3 border border-amber-500/30">
                    <div class="flex items-center gap-2 mb-2">
                      <GitBranch class="h-4 w-4 text-amber-500" />
                      <span class="text-sm font-medium text-amber-600 dark:text-amber-400">If Condition</span>
                    </div>
                    <div v-if="comp['routing-field']" class="space-y-1.5">
                      <p class="text-xs text-muted-foreground">Field: <span class="font-mono font-medium text-foreground">{{ comp['routing-field'] }}</span></p>
                      <div v-for="(cond, ci) in comp.conditions" :key="ci" class="flex items-center gap-1.5 text-xs">
                        <span class="text-amber-600 font-bold">→</span>
                        <span>= "<span class="font-medium">{{ cond.value || '...' }}</span>"</span>
                        <span class="text-muted-foreground">→</span>
                        <Badge variant="outline" class="text-[10px] py-0">{{ getScreenTitle(cond.target_screen) }}</Badge>
                      </div>
                      <div v-if="comp['else-screen']" class="flex items-center gap-1.5 text-xs">
                        <span class="text-amber-600 font-bold">→</span>
                        <span class="text-muted-foreground">else →</span>
                        <Badge variant="outline" class="text-[10px] py-0">{{ getScreenTitle(comp['else-screen']) }}</Badge>
                      </div>
                    </div>
                    <p v-else class="text-xs text-muted-foreground italic">Click to configure conditions</p>
                  </div>
                </template>

                <!-- Generic fallback -->
                <template v-else>
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <component :is="getComponentIcon(comp.type)" class="h-4 w-4" />
                    {{ getComponentLabel(comp) }}
                  </div>
                </template>
              </div>

              <div
                v-if="selectedScreen.layout.children.length === 0"
                class="p-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg"
              >
                Add components from the palette
              </div>
            </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div v-else class="flex-1 flex items-center justify-center text-muted-foreground">
        <div class="text-center">
          <Layers class="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Add a screen to get started</p>
          <Button class="mt-4" @click="addScreen">
            <Plus class="h-4 w-4 mr-2" />
            Add Screen
          </Button>
        </div>
      </div>
    </Card>

    <!-- Properties Panel -->
    <Card class="w-72 flex-shrink-0 flex flex-col overflow-hidden">
      <CardHeader class="py-3 px-4 flex-shrink-0">
        <CardTitle class="text-sm font-medium flex items-center gap-2">
          <Settings2 class="h-4 w-4" />
          Properties
        </CardTitle>
      </CardHeader>
      <Separator />
      <ScrollArea class="flex-1">
        <div v-if="selectedComponent" class="p-4 space-y-4">
          <div class="flex items-center justify-between">
            <Badge>{{ getComponentLabel(selectedComponent) }}</Badge>
            <div class="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :disabled="selectedComponentIndex === 0"
                @click="moveComponent(selectedComponentIndex!, 'up')"
              >
                <span class="rotate-180">▼</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :disabled="selectedComponentIndex === selectedScreen!.layout.children.length - 1"
                @click="moveComponent(selectedComponentIndex!, 'down')"
              >
                ▼
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-destructive"
                @click="removeComponent(selectedComponentIndex!)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <!-- Text property -->
          <div v-if="'text' in selectedComponent" class="space-y-2">
            <Label class="text-xs">Text</Label>
            <Input
              :model-value="selectedComponent.text"
              @update:model-value="updateComponentProperty('text', $event)"
            />
          </div>

          <!-- Label property -->
          <div v-if="'label' in selectedComponent && selectedComponent.type !== 'Footer'" class="space-y-2">
            <Label class="text-xs">Label</Label>
            <Input
              :model-value="selectedComponent.label"
              @update:model-value="updateComponentProperty('label', $event)"
            />
          </div>

          <!-- Name property -->
          <div v-if="'name' in selectedComponent" class="space-y-2">
            <Label class="text-xs">Field Name (Key)</Label>
            <Input
              :model-value="selectedComponent.name"
              @update:model-value="updateComponentProperty('name', $event)"
              class="font-mono text-sm"
              placeholder="e.g. email, phone, message"
            />
            <p class="text-xs text-muted-foreground">
              This key is used in the response data. Use lowercase with underscores (e.g. customer_name).
            </p>
          </div>

          <!-- Required property -->
          <div v-if="'required' in selectedComponent" class="flex items-center justify-between">
            <Label class="text-xs">Required</Label>
            <Switch
              :checked="selectedComponent.required"
              @update:checked="updateComponentProperty('required', $event)"
            />
          </div>

          <!-- Options for Dropdown, Radio, Checkbox -->
          <div v-if="selectedComponent['data-source']" class="space-y-2">
            <div class="flex items-center justify-between">
              <Label class="text-xs">Options</Label>
              <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addOption">
                <Plus class="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            <div class="space-y-2">
              <div
                v-for="(opt, index) in selectedComponent['data-source']"
                :key="opt.id"
                class="flex gap-2"
              >
                <Input
                  :model-value="opt.title"
                  @update:model-value="updateOption(index, 'title', $event)"
                  class="text-sm"
                  placeholder="Option text"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-9 w-9 flex-shrink-0"
                  @click="removeOption(index)"
                >
                  <Trash2 class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <!-- Footer specific -->
          <div v-if="selectedComponent.type === 'Footer'" class="space-y-4">
            <div class="space-y-2">
              <Label class="text-xs">Button Text</Label>
              <Input
                :model-value="selectedComponent.label"
                @update:model-value="updateComponentProperty('label', $event)"
              />
            </div>
            <div class="space-y-2">
              <Label class="text-xs">Action</Label>
              <Select
                :model-value="selectedComponent['on-click-action']?.name || 'complete'"
                @update:model-value="updateComponentProperty('on-click-action', { name: $event, payload: {} })"
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete">Complete Flow</SelectItem>
                  <SelectItem value="navigate">Navigate to Screen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div
              v-if="selectedComponent['on-click-action']?.name === 'navigate'"
              class="space-y-2"
            >
              <Label class="text-xs">Target Screen</Label>
              <Select
                :model-value="selectedComponent['on-click-action']?.next?.name || ''"
                @update:model-value="updateComponentProperty('on-click-action', {
                  name: 'navigate',
                  next: { type: 'screen', name: $event }
                })"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select screen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="screen in screens.filter(s => s.id !== selectedScreen?.id)"
                    :key="screen.id"
                    :value="screen.id"
                  >
                    {{ screen.title }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- Conditional Router specific -->
          <div v-if="selectedComponent.type === 'ConditionalRouter'" class="space-y-4">
            <div class="space-y-2">
              <Label class="text-xs font-medium">Source Field</Label>
              <Select
                :model-value="selectedComponent['routing-field'] || ''"
                @update:model-value="updateComponentProperty('routing-field', $event)"
              >
                <SelectTrigger><SelectValue placeholder="Select field to check" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="field in availableFields" :key="field.name" :value="field.name">
                    {{ field.label }} ({{ field.name }})
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-[11px] text-muted-foreground">Pick which field's value determines the next screen</p>
            </div>

            <Separator />

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <Label class="text-xs font-medium">Routing Rules</Label>
                <Button variant="ghost" size="sm" class="h-6 text-xs" @click="addCondition">
                  <Plus class="h-3 w-3 mr-1" /> Add Rule
                </Button>
              </div>
              <div class="space-y-3">
                <div
                  v-for="(cond, ci) in selectedComponent.conditions"
                  :key="ci"
                  class="p-3 rounded-md border bg-muted/30 space-y-2"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-amber-600 dark:text-amber-400">Rule {{ ci + 1 }}</span>
                    <Button variant="ghost" size="icon" class="h-6 w-6" :disabled="selectedComponent.conditions.length <= 1" @click="removeCondition(ci)">
                      <Trash2 class="h-3 w-3" />
                    </Button>
                  </div>
                  <div class="space-y-1">
                    <Label class="text-[11px] text-muted-foreground">If value equals</Label>
                    <Select
                      v-if="routingFieldOptions.length > 0"
                      :model-value="cond.value"
                      @update:model-value="updateCondition(ci, 'value', $event as string)"
                    >
                      <SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Select value" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="opt in routingFieldOptions" :key="opt.id" :value="opt.id">{{ opt.title }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      v-else
                      :model-value="cond.value"
                      @update:model-value="updateCondition(ci, 'value', $event as string)"
                      class="h-8 text-xs"
                      placeholder="Enter value to match"
                    />
                  </div>
                  <div class="space-y-1">
                    <Label class="text-[11px] text-muted-foreground">Navigate to</Label>
                    <Select
                      :model-value="cond.target_screen"
                      @update:model-value="updateCondition(ci, 'target_screen', $event as string)"
                    >
                      <SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Select screen" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="scr in screens.filter(s => s.id !== selectedScreen?.id)" :key="scr.id" :value="scr.id">{{ scr.title }}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div class="space-y-2">
              <Label class="text-xs font-medium">Default (Else) Screen</Label>
              <Select
                :model-value="selectedComponent['else-screen'] || ''"
                @update:model-value="updateComponentProperty('else-screen', $event)"
              >
                <SelectTrigger><SelectValue placeholder="Select default screen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__complete">Complete Flow</SelectItem>
                  <SelectItem v-for="scr in screens.filter(s => s.id !== selectedScreen?.id)" :key="scr.id" :value="scr.id">{{ scr.title }}</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-[11px] text-muted-foreground">Where to go if no condition matches</p>
            </div>
          </div>
        </div>
        <div v-else class="p-4 text-center text-sm text-muted-foreground">
          Select a component to edit its properties
        </div>
      </ScrollArea>
    </Card>
  </div>
</template>
