import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { PdfTable } from '../utils/pdfDownload';

interface PreviewModalProps {
  visible: boolean;
  title: string;
  subtitle: string;
  totalRows: number;
  recordCount?: number;
  previewRows: Array<Record<string, string>>;
  columns: string[];
  /**
   * The tables used to build the PDF. When supplied, the preview renders a
   * document-like version of those tables instead of the legacy flat export
   * summary. Keeping this data in the modal makes the preview match the file.
   */
  previewTables?: PdfTable[];
  documentTitle?: string;
  documentSubtitle?: string;
  stats?: {
    label: string;
    value: string;
    icon?: string;
  }[];
  fileSize?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  confirmColor?: string;
}

export default function DownloadPreviewModal({
  visible,
  title,
  subtitle,
  totalRows,
  recordCount,
  previewRows,
  columns,
  previewTables,
  documentTitle,
  documentSubtitle,
  stats,
  fileSize,
  onConfirm,
  onCancel,
  confirmText = 'Download',
  confirmColor = '#2563eb',
}: PreviewModalProps) {
  const sampleSize = Math.min(5, previewRows.length);
  const hasStructuredPreview = Boolean(previewTables?.length);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{title}</Text>
              <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
              <MaterialIcons name="close" size={24} color="#5f687a" />
            </TouchableOpacity>
          </View>

          {/* Stats Section */}
          {stats && stats.length > 0 && (
            <View style={styles.statsSection}>
              {stats.map((stat, index) => (
                <View key={index} style={styles.statItem}>
                  {stat.icon && (
                    <MaterialIcons
                      name={stat.icon as any}
                      size={18}
                      color="#4067d9"
                      style={styles.statIcon}
                    />
                  )}
                  <View>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                    <Text style={styles.statValue}>{stat.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Preview Table */}
          <View style={styles.previewSection}>
            {hasStructuredPreview ? (
              <ScrollView
                style={styles.documentScroll}
                contentContainerStyle={styles.documentScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <View style={styles.documentPage}>
                  <Text style={styles.documentTitle}>
                    {documentTitle || title.replace(/^Preview:\s*/i, '')}
                  </Text>
                  <Text style={styles.documentSubtitle}>
                    {documentSubtitle || subtitle}
                  </Text>

                  {previewTables?.map((table, tableIndex) => {
                    const visibleRows = table.rows.length <= 8
                      ? table.rows
                      : table.rows.slice(0, 5);
                    const totalWeight = table.columns.reduce(
                      (sum, column) => sum + Math.max(0.1, column.width ?? 1),
                      0,
                    );
                    const tableMinWidth = Math.max(560, table.columns.length * 108);

                    return (
                      <View key={`${table.title || 'table'}-${tableIndex}`} style={styles.documentSection}>
                        {table.title ? (
                          <Text style={styles.documentSectionTitle}>{table.title}</Text>
                        ) : null}
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          style={styles.documentTableScroll}
                        >
                          <View style={[styles.documentTable, { minWidth: tableMinWidth }]}>
                            <View style={styles.documentTableRow}>
                              {table.columns.map(column => (
                                <View
                                  key={column.key}
                                  style={[
                                    styles.documentTableHeaderCell,
                                    { flex: Math.max(0.1, column.width ?? 1) / totalWeight },
                                  ]}
                                >
                                  <Text style={styles.documentTableHeaderText}>{column.label}</Text>
                                </View>
                              ))}
                            </View>

                            {visibleRows.length ? visibleRows.map((row, rowIndex) => (
                              <View
                                key={rowIndex}
                                style={[
                                  styles.documentTableRow,
                                  rowIndex % 2 === 1 && styles.documentTableAlternateRow,
                                ]}
                              >
                                {table.columns.map(column => (
                                  <View
                                    key={column.key}
                                    style={[
                                      styles.documentTableCell,
                                      { flex: Math.max(0.1, column.width ?? 1) / totalWeight },
                                    ]}
                                  >
                                    <Text style={styles.documentTableCellText}>
                                      {formatPreviewValue(row[column.key])}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )) : (
                              <View style={styles.documentEmptyRow}>
                                <Text style={styles.documentEmptyText}>
                                  {table.emptyMessage || 'No records available.'}
                                </Text>
                              </View>
                            )}
                          </View>
                        </ScrollView>
                        {visibleRows.length < table.rows.length ? (
                          <Text style={styles.documentMoreText}>
                            Showing {visibleRows.length} of {table.rows.length} rows
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            ) : (
              <>
                <Text style={styles.previewTitle}>
                  Preview ({sampleSize} of {totalRows} rows)
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.tableWrapper}
                >
                  <View>
                    {/* Table Header */}
                    <View style={styles.tableHeader}>
                      {columns.map((col, index) => (
                        <Text
                          key={index}
                          style={[
                            styles.tableHeaderCell,
                            index === 0 && styles.firstCell,
                          ]}
                          numberOfLines={1}
                        >
                          {col}
                        </Text>
                      ))}
                    </View>

                    {/* Table Rows */}
                    {previewRows.slice(0, sampleSize).map((row, rowIndex) => (
                      <View
                        key={rowIndex}
                        style={[
                          styles.tableRow,
                          rowIndex % 2 === 0 && styles.tableRowAlternate,
                        ]}
                      >
                        {columns.map((col, colIndex) => (
                          <Text
                            key={colIndex}
                            style={[
                              styles.tableCell,
                              colIndex === 0 && styles.firstCell,
                            ]}
                            numberOfLines={2}
                          >
                            {row[col] || '-'}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </View>

          {/* File Info */}
          <View style={styles.fileInfo}>
            <View style={styles.fileInfoRow}>
              <MaterialIcons name="insert-drive-file" size={16} color="#7c8aa5" />
              <Text style={styles.fileInfoText}>
                Total records: {recordCount ?? totalRows}
              </Text>
            </View>
            {fileSize && (
              <View style={styles.fileInfoRow}>
                <MaterialIcons name="storage" size={16} color="#7c8aa5" />
                <Text style={styles.fileInfoText}>Estimated size: {fileSize}</Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onCancel}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, { backgroundColor: confirmColor }]}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <MaterialIcons name="download" size={16} color="#fff" />
              <Text style={styles.confirmButtonText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxWidth: 800,
    width: '100%',
    height: '82%',
    minHeight: 520,
    maxHeight: '92%',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerContent: {
    flex: 1,
    paddingRight: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#233046',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#617086',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    marginRight: -8,
  },
  statsSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f7f9fe',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statIcon: {
    marginRight: 8,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#233046',
    marginTop: 2,
  },
  previewSection: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  documentScroll: {
    flex: 1,
    minHeight: 0,
  },
  documentScrollContent: {
    paddingBottom: 2,
  },
  documentPage: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d7dee8',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  documentTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    color: '#123456',
  },
  documentSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 8,
  },
  documentSection: {
    marginTop: 18,
  },
  documentSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#172b4d',
    marginBottom: 7,
  },
  documentTableScroll: {
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#c7d2d9',
  },
  documentTable: {
    backgroundColor: '#fff',
  },
  documentTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#c7d2d9',
    minHeight: 28,
  },
  documentTableHeaderCell: {
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 7,
    backgroundColor: '#126b3b',
    borderRightWidth: 1,
    borderRightColor: '#c7d2d9',
  },
  documentTableHeaderText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    color: '#fff',
  },
  documentTableCell: {
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderRightColor: '#c7d2d9',
  },
  documentTableCellText: {
    fontSize: 10,
    lineHeight: 13,
    color: '#17324d',
  },
  documentTableAlternateRow: {
    backgroundColor: '#f3f8f5',
  },
  documentEmptyRow: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#f3f8f5',
  },
  documentEmptyText: {
    fontSize: 10,
    color: '#64748b',
  },
  documentMoreText: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 5,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475069',
    marginBottom: 8,
  },
  tableWrapper: {
    flex: 1,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  tableHeaderCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#333',
    minWidth: 80,
    textTransform: 'uppercase',
  },
  firstCell: {
    minWidth: 120,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  tableRowAlternate: {
    backgroundColor: '#f9fafb',
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: '#475569',
    minWidth: 80,
  },
  fileInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 6,
  },
  fileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileInfoText: {
    fontSize: 11,
    color: '#64748b',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475069',
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  confirmButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});

function formatPreviewValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  if (Array.isArray(value)) {
    return value.map(item => formatPreviewValue(item)).join(', ');
  }
  return String(value).replace(/\s+/g, ' ').trim() || '-';
}
