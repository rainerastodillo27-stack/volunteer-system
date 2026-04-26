const test = () => (
<View>
          {showComposer ? (
            <View style={[styles.composerShell, isVolunteerCompact && styles.composerShellCompact]}>
              {detailCanPostNeeds ? (
                <View style={[styles.modeToggleRow, isVolunteerCompact && styles.modeToggleRowCompact]}>
                <TouchableOpacity
                  style={[
                    styles.modeToggleButton,
                    isVolunteerCompact && styles.modeToggleButtonCompact,
                    composerMode === 'message' && styles.modeToggleButtonActive,
                  ]}
                  onPress={() => setComposerMode('message')}
                >
                  <MaterialIcons
                    name="chat-bubble-outline"
                    size={16}
                    color={composerMode === 'message' ? '#ffffff' : '#166534'}
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      composerMode === 'message' && styles.modeToggleTextActive,
                    ]}
                  >
                    Chat message
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeToggleButton,
                    isVolunteerCompact && styles.modeToggleButtonCompact,
                    composerMode === 'need-post' && styles.modeToggleButtonActive,
                  ]}
                  onPress={() => setComposerMode('need-post')}
                >
                  <MaterialIcons
                    name="campaign"
                    size={16}
                    color={composerMode === 'need-post' ? '#ffffff' : '#166534'}
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      composerMode === 'need-post' && styles.modeToggleTextActive,
                    ]}
                  >
                    Needs card
                  </Text>
                </TouchableOpacity>

                {['admin', 'partner'].includes(user?.role || '') ? (
                  <TouchableOpacity
                    style={[
                      styles.modeToggleButton,
                      isVolunteerCompact && styles.modeToggleButtonCompact,
                      composerMode === 'scope-proposal' && styles.modeToggleButtonActive,
                    ]}
                    onPress={() => setComposerMode('scope-proposal')}
                  >
                    <MaterialIcons
                      name="description"
                      size={16}
                      color={composerMode === 'scope-proposal' ? '#ffffff' : '#166534'}
                    />
                    <Text
                      style={[
                        styles.modeToggleText,
                        composerMode === 'scope-proposal' && styles.modeToggleTextActive,
                      ]}
                    >
                      Scope proposal
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {detailCanPostNeeds && composerMode === 'need-post' ? (
              <View style={[styles.needComposerCard, isVolunteerCompact && styles.needComposerCardCompact]}>
                <Text style={styles.needComposerTitle}>Post a planning need in this group</Text>
                <Text style={styles.needComposerSubtitle}>
                  Share exactly what the team needs so volunteers, partners, and admins can coordinate around one clear request.
                </Text>

                <TextInput
                  value={needDraft.title}
                  onChangeText={value => setNeedDraft(current => ({ ...current, title: value }))}
                  placeholder="Need title"
                  placeholderTextColor="#94a3b8"
                  style={styles.composerInput}
                />

                <TextInput
                  value={needDraft.details}
                  onChangeText={value => setNeedDraft(current => ({ ...current, details: value }))}
                  placeholder="Describe the need, context, and expected support"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <View style={[styles.dualInputRow, !isMedium && styles.dualInputRowStacked]}>
                  <TextInput
                    value={needDraft.quantityLabel}
                    onChangeText={value => setNeedDraft(current => ({ ...current, quantityLabel: value }))}
                    placeholder="Quantity or target support"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                  <TextInput
                    value={needDraft.targetDate}
                    onChangeText={value => setNeedDraft(current => ({ ...current, targetDate: value }))}
                    placeholder="Target date (YYYY-MM-DD)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                </View>

                <Text style={styles.chipGroupLabel}>Category</Text>
                <View style={styles.chipWrap}>
                  {NEED_CATEGORIES.map(category => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.choiceChip,
                        needDraft.category === category && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, category }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.category === category && styles.choiceChipTextActive,
                        ]}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.chipGroupLabel}>Priority</Text>
                <View style={styles.chipWrap}>
                  {NEED_PRIORITIES.map(priority => (
                    <TouchableOpacity
                      key={priority}
                      style={[
                        styles.choiceChip,
                        needDraft.priority === priority && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, priority }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.priority === priority && styles.choiceChipTextActive,
                        ]}
                      >
                        {priority}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.chipGroupLabel}>Status</Text>
                <View style={styles.chipWrap}>
                  {NEED_STATUSES.map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.choiceChip,
                        needDraft.status === status && styles.choiceChipActive,
                      ]}
                      onPress={() => setNeedDraft(current => ({ ...current, status }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          needDraft.status === status && styles.choiceChipTextActive,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {detailCanPostNeeds && composerMode === 'scope-proposal' && ['admin', 'partner'].includes(user?.role || '') ? (
              <ScrollView style={styles.scopeProposalComposerCard} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scopeProposalComposerContent}>
                <View style={styles.scopeProposalComposerHeader}>
                  <View style={styles.scopeProposalComposerHeaderIcon}>
                    <MaterialIcons name="edit-note" size={20} color="#1d4ed8" />
                  </View>
                  <View style={styles.scopeProposalComposerHeaderCopy}>
                    <Text style={styles.scopeProposalComposerTitle}>Propose a program</Text>
                    <Text style={styles.scopeProposalComposerSubtitle}>
                      Define goals, deliverables, and success criteria for this program.
                    </Text>
                  </View>
                </View>

                <TextInput
                  value={scopeProposalDraft.title}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, title: value }))}
                  placeholder="Proposal title"
                  placeholderTextColor="#94a3b8"
                  style={styles.composerInput}
                />

                <TextInput
                  value={scopeProposalDraft.description}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, description: value }))}
                  placeholder="Describe the scope and project overview"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <TextInput
                  value={scopeProposalDraft.included}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, included: value }))}
                  placeholder="Included in scope (one item per line)"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <TextInput
                  value={scopeProposalDraft.excluded}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, excluded: value }))}
                  placeholder="Excluded from scope (one item per line)"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <View style={[styles.dualInputRow, !isMedium && styles.dualInputRowStacked]}>
                  <TextInput
                    value={scopeProposalDraft.timeline}
                    onChangeText={value => setScopeProposalDraft(current => ({ ...current, timeline: value }))}
                    placeholder="Timeline (e.g., 3 months, Q1 2024)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                  <TextInput
                    value={scopeProposalDraft.resources}
                    onChangeText={value => setScopeProposalDraft(current => ({ ...current, resources: value }))}
                    placeholder="Resource requirements"
                    placeholderTextColor="#94a3b8"
                    style={[styles.composerInput, styles.dualInputField]}
                  />
                </View>

                <TextInput
                  value={scopeProposalDraft.successCriteria}
                  onChangeText={value => setScopeProposalDraft(current => ({ ...current, successCriteria: value }))}
                  placeholder="How will success be measured?"
                  placeholderTextColor="#94a3b8"
                  style={[styles.composerInput, styles.composerTextArea]}
                  multiline
                />

                <Text style={styles.chipGroupLabel}>Status</Text>
                <View style={styles.chipWrap}>
                  {(['Draft', 'Proposed'] as const).map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.choiceChip,
                        scopeProposalDraft.status === status && styles.choiceChipActive,
                      ]}
                      onPress={() => setScopeProposalDraft(current => ({ ...current, status }))}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          scopeProposalDraft.status === status && styles.choiceChipTextActive,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : null}

            {selectedAttachmentUri ? (
              <View style={styles.attachmentPreviewCard}>
                <Image source={{ uri: selectedAttachmentUri }} style={styles.attachmentPreviewImage} />
                <TouchableOpacity
                  style={styles.attachmentRemoveButton}
                  onPress={() => setSelectedAttachmentUri(null)}
                >
                  <MaterialIcons name="close" size={18} color="#ffffff" />
                </TouchableOpacity>
              </View>
            ) : null}

            {selectedNeedMessage && composerMode === 'message' ? (
              <View style={styles.replyBanner}>
                <View style={styles.replyBannerTopRow}>
                  <View style={styles.replyBannerCopy}>
                    <Text style={styles.replyBannerLabel}>Responding to need</Text>
                    <Text style={styles.replyBannerTitle} numberOfLines={1}>
                      {selectedNeedMessage.needPost?.title || selectedNeedMessage.responseToTitle || 'Planning need'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.replyBannerDismiss}
                    onPress={() => {
                      setSelectedNeedMessageId(null);
                      setSelectedNeedResponseAction('Can Help');
                    }}
                  >
                    <MaterialIcons name="close" size={16} color="#166534" />
                  </TouchableOpacity>
                </View>

                <View style={styles.replyActionRow}>
                  {NEED_RESPONSE_ACTIONS.map(action => {
                    const palette = getNeedResponsePalette(action);
                    const selected = selectedNeedResponseAction === action;

                    return (
                      <TouchableOpacity
                        key={`reply-${action}`}
                        style={[
                          styles.replyActionChip,
                          selected && { backgroundColor: palette.backgroundColor, borderColor: palette.backgroundColor },
</View>
);